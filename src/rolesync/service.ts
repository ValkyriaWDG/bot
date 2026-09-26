import type {
  Membership,
  MembershipProvider,
  OutboxItem,
  RoleSyncEvent,
  SyncStore,
} from '../contracts.js';
import { ROLE_SYNC_PATH, signEvent, validateEvent } from './signing.js';
export interface RoleSyncConfig {
  guildId: string;
  url: string;
  keyId: string;
  secret: string;
  enabled: boolean;
  reconcileSeconds?: number;
}
export interface RoleSyncOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  nonce?: () => string;
  batchSize?: number;
  timeoutMs?: number;
  allowLoopbackHttp?: boolean;
}

const VALID_ID = /^[1-9][0-9]{0,19}$/;

export class RoleSyncService {
  private readonly generations = new Map<string, number>();
  private readonly reads = new Map<string, Promise<unknown>>();
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;
  private readonly transport: typeof fetch;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private sending = false;
  private reconciling = false;
  private blockedUntil = 0;
  private cursor: string | undefined;

  constructor(
    private readonly config: RoleSyncConfig,
    private readonly store: SyncStore,
    private readonly provider: MembershipProvider,
    private readonly options: RoleSyncOptions = {},
  ) {
    if (!VALID_ID.test(config.guildId)) throw new Error('ROLE_SYNC_INVALID_CONFIG');
    this.now = options.now ?? (() => new Date());
    this.transport = options.fetch ?? fetch;
    this.batchSize = options.batchSize ?? 10;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isInteger(this.batchSize) ||
      this.batchSize < 1 ||
      this.batchSize > 20 ||
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 10_000
    )
      throw new Error('ROLE_SYNC_INVALID_CONFIG');
    if (config.enabled) {
      let url: URL;
      try {
        url = new URL(config.url);
      } catch {
        throw new Error('ROLE_SYNC_INVALID_CONFIG');
      }
      const localHttp =
        options.allowLoopbackHttp === true &&
        url.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        (url.protocol !== 'https:' && !localHttp) ||
        url.pathname !== ROLE_SYNC_PATH ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId) ||
        Buffer.byteLength(config.secret, 'utf8') < 32
      )
        throw new Error('ROLE_SYNC_INVALID_CONFIG');
    }
  }

  private enqueue<T>(
    queues: Map<string, Promise<unknown>>,
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = queues.get(userId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    queues.set(userId, pending);
    const cleanup = () => {
      if (queues.get(userId) === pending) queues.delete(userId);
    };
    void pending.then(cleanup, cleanup);
    return pending;
  }

  private validateMember(member: Membership, expectedUserId: string): Membership {
    try {
      const checked = validateEvent({
        schemaVersion: 1,
        eventId: '00000000-0000-4000-8000-000000000000',
        guildId: member.guildId,
        userId: member.userId,
        roleIds: member.roleIds,
        membershipState: member.state,
        observedAt: member.observedAt,
        sequence: '1',
      });
      if (
        checked.guildId !== this.config.guildId ||
        checked.userId !== expectedUserId ||
        Date.parse(checked.observedAt) > this.now().getTime() + 300_000
      )
        throw new Error();
      return {
        guildId: checked.guildId,
        userId: checked.userId,
        roleIds: checked.roleIds,
        state: checked.membershipState,
        observedAt: checked.observedAt,
      };
    } catch {
      throw new Error('ROLE_SYNC_INVALID_MEMBERSHIP');
    }
  }

  private async save(member: Membership): Promise<RoleSyncEvent> {
    try {
      return await this.store.saveMembership(member);
    } catch {
      throw new Error('ROLE_SYNC_STORE_UNAVAILABLE');
    }
  }

  refresh(userId: string): Promise<RoleSyncEvent | null> {
    if (!VALID_ID.test(userId)) return Promise.reject(new Error('ROLE_SYNC_INVALID_MEMBERSHIP'));
    const generation = this.generations.get(userId) ?? 0;
    return this.enqueue(this.reads, userId, async () => {
      if ((this.generations.get(userId) ?? 0) !== generation) return null;
      let observed: Membership;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        observed = await Promise.race([
          this.provider.fetch(this.config.guildId, userId),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('TIMEOUT')), this.timeoutMs);
          }),
        ]);
      } catch {
        throw new Error('ROLE_SYNC_MEMBERSHIP_UNAVAILABLE');
      } finally {
        if (timer) clearTimeout(timer);
      }
      const member = this.validateMember(observed, userId);
      if (this.now().getTime() - Date.parse(member.observedAt) > 60_000)
        throw new Error('ROLE_SYNC_STALE_OBSERVATION');
      return this.enqueue(this.writes, userId, () =>
        (this.generations.get(userId) ?? 0) === generation
          ? this.save(member)
          : Promise.resolve(null),
      );
    });
  }

  observe(member: Membership): Promise<RoleSyncEvent> {
    const checked = this.validateMember(member, member.userId);
    this.generations.set(member.userId, (this.generations.get(member.userId) ?? 0) + 1);
    return this.enqueue(this.writes, member.userId, () => this.save(checked));
  }

  depart(userId: string): Promise<RoleSyncEvent> {
    return this.observe({
      guildId: this.config.guildId,
      userId,
      roleIds: [],
      state: 'left',
      observedAt: this.now().toISOString(),
    });
  }

  async reconcile(): Promise<{ processed: number; failed: number }> {
    if (this.reconciling) return { processed: 0, failed: 0 };
    this.reconciling = true;
    let processed = 0;
    let failed = 0;
    try {
      const users = await this.store.trackedMembers(this.batchSize, this.cursor);
      for (const userId of users) {
        try {
          await this.refresh(userId);
          processed++;
        } catch {
          failed++;
        }
      }
      this.cursor = users.length < this.batchSize ? undefined : users.at(-1);
      return { processed, failed };
    } catch {
      throw new Error('ROLE_SYNC_STORE_UNAVAILABLE');
    } finally {
      this.reconciling = false;
    }
  }

  async tick(): Promise<void> {
    if (!this.config.enabled || this.sending || this.now().getTime() < this.blockedUntil) return;
    this.sending = true;
    try {
      // One lease at a time keeps its lifetime independent of other slow deliveries.
      for (let index = 0; index < this.batchSize; index++) {
        if (this.now().getTime() < this.blockedUntil) break;
        const [item] = await this.store.claimOutbox(this.now(), 1);
        if (!item) break;
        await this.deliver(item);
      }
    } catch {
      throw new Error('ROLE_SYNC_STORE_UNAVAILABLE');
    } finally {
      this.sending = false;
    }
  }

  private async deliver(item: OutboxItem): Promise<void> {
    let response: Response;
    try {
      const signed = signEvent(item.event, {
        url: this.config.url,
        keyId: this.config.keyId,
        secret: this.config.secret,
        now: this.now(),
        ...(this.options.nonce ? { nonce: this.options.nonce() } : {}),
      });
      response = await this.transport(this.config.url, {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      await this.retry(item, 'ROLE_SYNC_TRANSPORT');
      return;
    }
    try {
      if (response.status === 200 || response.status === 204) {
        await this.store.completeOutbox(item.event.eventId, item.leaseId);
        return;
      }
      if (response.status === 409) {
        const acknowledgement = await this.readAcknowledgement(response);
        if (
          acknowledgement?.eventId === item.event.eventId &&
          ['DUPLICATE_EVENT', 'STALE_EVENT'].includes(acknowledgement.code ?? '')
        ) {
          await this.store.completeOutbox(item.event.eventId, item.leaseId);
          return;
        }
        await this.retry(item, 'ROLE_SYNC_CONFLICT');
        return;
      }
      if (response.status >= 300 && response.status < 400) {
        await this.store.failOutbox(item.event.eventId, item.leaseId, 'ROLE_SYNC_REDIRECT');
        return;
      }
      if (response.status === 429 || response.status >= 500) {
        await this.retry(
          item,
          response.status === 429 ? 'ROLE_SYNC_RATE_LIMITED' : 'ROLE_SYNC_REMOTE_UNAVAILABLE',
          response.headers.get('Retry-After'),
        );
        return;
      }
      await this.store.failOutbox(item.event.eventId, item.leaseId, 'ROLE_SYNC_REMOTE_REJECTED');
    } finally {
      if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
    }
  }

  private async readAcknowledgement(
    response: Response,
  ): Promise<{ code?: string; eventId?: string } | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 4_096) return null;
        chunks.push(result.value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object') return null;
      const object = data as Record<string, unknown>;
      return {
        ...(typeof object.code === 'string' ? { code: object.code } : {}),
        ...(typeof object.eventId === 'string' ? { eventId: object.eventId } : {}),
      };
    } catch {
      return null;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async retry(item: OutboxItem, code: string, retryAfter?: string | null): Promise<void> {
    const now = this.now().getTime();
    let delay = Math.min(3_600_000, 1_000 * 2 ** Math.min(item.attempts, 12));
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const hinted =
        Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Date.parse(retryAfter) - now;
      if (Number.isFinite(hinted) && hinted > delay) delay = hinted;
    }
    if (!Number.isFinite(now + delay) || now + delay > 8.64e15) {
      await this.store.failOutbox(item.event.eventId, item.leaseId, 'ROLE_SYNC_INVALID_RETRY');
      return;
    }
    if (code === 'ROLE_SYNC_RATE_LIMITED')
      this.blockedUntil = Math.max(this.blockedUntil, now + delay);
    if (item.attempts >= 8) {
      await this.store.failOutbox(item.event.eventId, item.leaseId, 'ROLE_SYNC_ATTEMPTS_EXHAUSTED');
      return;
    }
    await this.store.retryOutbox(item.event.eventId, item.leaseId, new Date(now + delay), code);
  }
}
