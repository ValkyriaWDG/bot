import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Membership,
  MembershipProvider,
  OutboxItem,
  RoleSyncEvent,
  SyncStore,
} from '../src/contracts.js';
import { signEvent, verifySignedEvent } from '../src/rolesync/signing.js';
import { RoleSyncService } from '../src/rolesync/service.js';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const SECRET = 'fixture-only-signing-secret-000000000000';
const GUILD = '100000000000000001';
const USER = '200000000000000001';
const ROLE = '300000000000000001';
const event: RoleSyncEvent = {
  schemaVersion: 1,
  eventId: 'c74f8948-262f-4c8d-8e9a-9a8b996fb083',
  guildId: GUILD,
  userId: USER,
  roleIds: [ROLE],
  membershipState: 'present',
  observedAt: NOW.toISOString(),
  sequence: '1',
};
const member = (userId = USER): Membership => ({
  guildId: GUILD,
  userId,
  roleIds: [ROLE],
  state: 'present',
  observedAt: NOW.toISOString(),
});
const provider: MembershipProvider = { fetch: async (_guild, userId) => member(userId) };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

class MemoryStore implements SyncStore {
  events: RoleSyncEvent[] = [];
  pending = new Map<string, { item: OutboxItem; due: Date; leased: boolean }>();
  retried: Array<{ eventId: string; at: Date; code: string }> = [];
  completed: string[] = [];
  failed: Array<{ eventId: string; code: string }> = [];
  tracked: string[] = [];
  async saveMembership(value: Membership) {
    const saved: RoleSyncEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      guildId: value.guildId,
      userId: value.userId,
      roleIds: [...value.roleIds],
      membershipState: value.state,
      observedAt: value.observedAt,
      sequence: String(this.events.length + 1),
    };
    this.events.push(saved);
    this.pending.set(saved.eventId, {
      item: { event: saved, attempts: 0, leaseId: 'unclaimed' },
      due: NOW,
      leased: false,
    });
    return saved;
  }
  async trackedMembers(limit: number, after?: string) {
    return this.tracked.filter((id) => !after || id > after).slice(0, limit);
  }
  async claimOutbox(now: Date, limit: number) {
    return [...this.pending.values()]
      .filter((entry) => !entry.leased && entry.due <= now)
      .slice(0, limit)
      .map((entry) => {
        entry.leased = true;
        entry.item = { ...entry.item, attempts: entry.item.attempts + 1, leaseId: randomUUID() };
        return entry.item;
      });
  }
  async completeOutbox(id: string, lease: string) {
    expect(this.pending.get(id)?.item.leaseId).toBe(lease);
    this.completed.push(id);
    this.pending.delete(id);
  }
  async retryOutbox(id: string, lease: string, at: Date, code: string) {
    const entry = this.pending.get(id)!;
    expect(entry.item.leaseId).toBe(lease);
    entry.leased = false;
    entry.due = at;
    this.retried.push({ eventId: id, at, code });
  }
  async failOutbox(id: string, lease: string, code: string) {
    expect(this.pending.get(id)?.item.leaseId).toBe(lease);
    this.failed.push({ eventId: id, code });
    this.pending.delete(id);
  }
}

async function httpFixture(
  handler: (body: string, request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    handler(body, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/integrations/discord/role-sync`;
}

function service(store: MemoryStore, url: string, membership = provider, options = {}) {
  return new RoleSyncService(
    {
      guildId: GUILD,
      url,
      keyId: 'fixture-key',
      secret: SECRET,
      enabled: true,
      reconcileSeconds: 60,
    },
    store,
    membership,
    { now: () => NOW, batchSize: 2, allowLoopbackHttp: true, ...options },
  );
}

describe('role-sync signing', () => {
  it('accepts the policy role limit and rejects an oversized observation before signing', () => {
    const roles = Array.from({ length: 251 }, (_, index) =>
      String(300000000000000000n + BigInt(index)),
    );
    const options = {
      url: 'https://web.invalid/api/integrations/discord/role-sync',
      keyId: 'fixture-key',
      secret: SECRET,
      now: NOW,
    };
    expect(() => signEvent({ ...event, roleIds: roles.slice(0, 250) }, options)).not.toThrow();
    expect(() => signEvent({ ...event, roleIds: roles }, options)).toThrow(
      'ROLE_SYNC_INVALID_EVENT',
    );
  });
  it('binds method, path, key, envelope and exact immutable UTF-8 body', () => {
    const signed = signEvent(event, {
      url: 'https://web.invalid/api/integrations/discord/role-sync',
      keyId: 'fixture-key',
      secret: SECRET,
      now: NOW,
      nonce: '0123456789abcdef0123456789abcdef',
    });
    const expectedInput = `POST\n/api/integrations/discord/role-sync\nfixture-key\n1790424000\n0123456789abcdef0123456789abcdef\n${JSON.stringify(event)}`;
    expect(signed.headers['X-Valkyria-Signature']).toBe(
      createHmac('sha256', SECRET).update(expectedInput).digest('hex'),
    );
    expect(signed.body).toBe(JSON.stringify(event));
    expect(
      verifySignedEvent({
        method: 'POST',
        path: '/api/integrations/discord/role-sync',
        headers: signed.headers,
        body: signed.body,
        guildId: GUILD,
        keys: { 'fixture-key': SECRET },
        now: NOW,
      }),
    ).toEqual(event);
  });

  it('rejects tampering, wrong guild, expired envelopes and malformed signatures without secret disclosure', () => {
    const signed = signEvent(event, {
      url: 'https://web.invalid/api/integrations/discord/role-sync',
      keyId: 'fixture-key',
      secret: SECRET,
      now: NOW,
    });
    const input = {
      method: 'POST',
      path: '/api/integrations/discord/role-sync',
      ...signed,
      guildId: GUILD,
      keys: { 'fixture-key': SECRET },
      now: NOW,
    };
    for (const invalid of [
      { ...input, body: signed.body.replace(ROLE, '300000000000000002') },
      { ...input, path: '/api/other' },
      { ...input, guildId: '100000000000000002' },
      { ...input, now: new Date(NOW.getTime() + 301_000) },
      { ...input, headers: { ...signed.headers, 'X-Valkyria-Signature': 'bad' } },
      { ...input, headers: { ...signed.headers, 'X-Valkyria-Nonce': `bad\n${SECRET}` } },
    ])
      expect(() => verifySignedEvent(invalid)).toThrow(/^ROLE_SYNC_/);
    expect(() =>
      signEvent(
        { ...event, roleIds: [ROLE, ROLE] },
        {
          url: 'https://web.invalid/api/integrations/discord/role-sync',
          keyId: 'fixture-key',
          secret: SECRET,
          now: NOW,
        },
      ),
    ).toThrow('ROLE_SYNC_INVALID_EVENT');
  });
});

describe('role-sync observations', () => {
  it('persists departure immediately and fences an already-started REST response', async () => {
    let finish!: (value: Membership) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const slow: MembershipProvider = {
      fetch: () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    const store = new MemoryStore();
    const sync = service(store, 'https://web.invalid/api/integrations/discord/role-sync', slow);
    const pending = sync.refresh(USER);
    await ready;
    await sync.depart(USER);
    expect(store.events.map((item) => item.membershipState)).toEqual(['left']);
    finish(member());
    await pending;
    expect(store.events.map((item) => item.membershipState)).toEqual(['left']);
  });

  it('does not fabricate departure for failed or mismatched REST observations', async () => {
    const store = new MemoryStore();
    const failed = service(store, 'https://web.invalid/api/integrations/discord/role-sync', {
      fetch: async () => {
        throw new Error(SECRET);
      },
    });
    await expect(failed.refresh(USER)).rejects.toThrow('ROLE_SYNC_MEMBERSHIP_UNAVAILABLE');
    const mismatched = service(store, 'https://web.invalid/api/integrations/discord/role-sync', {
      fetch: async () => member('200000000000000002'),
    });
    await expect(mismatched.refresh(USER)).rejects.toThrow('ROLE_SYNC_INVALID_MEMBERSHIP');
    expect(store.events).toEqual([]);
  });

  it('rejects stale provider observations instead of presenting cached roles as fresh', async () => {
    const store = new MemoryStore();
    const stale = service(store, 'https://web.invalid/api/integrations/discord/role-sync', {
      fetch: async () => ({
        ...member(),
        observedAt: new Date(NOW.getTime() - 61_000).toISOString(),
      }),
    });
    await expect(stale.refresh(USER)).rejects.toThrow('ROLE_SYNC_STALE_OBSERVATION');
    expect(store.events).toEqual([]);
  });

  it('bounds a stalled membership provider without storing a false departure', async () => {
    const store = new MemoryStore();
    const sync = service(
      store,
      'https://web.invalid/api/integrations/discord/role-sync',
      { fetch: () => new Promise(() => {}) },
      { timeoutMs: 20 },
    );
    await expect(sync.refresh(USER)).rejects.toThrow('ROLE_SYNC_MEMBERSHIP_UNAVAILABLE');
    expect(store.events).toHaveLength(0);
  }, 250);

  it('serializes same-member refreshes and advances bounded reconciliation pages', async () => {
    let active = 0;
    let peak = 0;
    const store = new MemoryStore();
    store.tracked = [USER, '200000000000000002', '200000000000000003'];
    const sync = service(store, 'https://web.invalid/api/integrations/discord/role-sync', {
      fetch: async (_guild, user) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return member(user);
      },
    });
    await Promise.all([sync.refresh(USER), sync.refresh(USER)]);
    expect(peak).toBe(1);
    await sync.reconcile();
    expect(store.events.slice(2).map((item) => item.userId)).toEqual(store.tracked.slice(0, 2));
    await sync.reconcile();
    expect(store.events.at(-1)?.userId).toBe(store.tracked[2]);
  });
});

describe('role-sync outbox transport', () => {
  it.each([200, 204])('delivers signed snapshots and acknowledges HTTP %i', async (status) => {
    const seen: string[] = [];
    const url = await httpFixture((body, request, response) => {
      const parsed = verifySignedEvent({
        method: request.method!,
        path: request.url!,
        body,
        headers: request.headers as Record<string, string>,
        guildId: GUILD,
        keys: { 'fixture-key': SECRET },
        now: NOW,
      });
      seen.push(parsed.sequence);
      response.writeHead(status).end();
    });
    const store = new MemoryStore();
    const sync = service(store, url);
    await sync.refresh(USER);
    await sync.tick();
    expect(seen).toEqual(['1']);
    expect(store.completed).toHaveLength(1);
  });

  it('honors Retry-After while keeping the event bytes and observedAt immutable on retry', async () => {
    const bodies: string[] = [];
    const nonces: string[] = [];
    let clock = NOW;
    const url = await httpFixture((body, request, response) => {
      bodies.push(body);
      nonces.push(String(request.headers['x-valkyria-nonce']));
      response.writeHead(bodies.length === 1 ? 429 : 204, { 'Retry-After': '90' }).end();
    });
    const store = new MemoryStore();
    const sync = service(store, url, provider, { now: () => clock });
    await sync.refresh(USER);
    await sync.tick();
    expect(store.retried[0]?.at.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 90_000);
    await sync.tick();
    expect(bodies).toHaveLength(1);
    clock = new Date(NOW.getTime() + 91_000);
    await sync.tick();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(nonces[0]).not.toBe(nonces[1]);
    expect(JSON.parse(bodies[1]!).observedAt).toBe(NOW.toISOString());
  });

  it('only accepts explicit matching duplicate/stale acknowledgements for HTTP 409', async () => {
    let valid = false;
    const url = await httpFixture((body, _request, response) => {
      response.writeHead(409, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          code: 'DUPLICATE_EVENT',
          eventId: valid ? JSON.parse(body).eventId : 'wrong',
        }),
      );
    });
    const store = new MemoryStore();
    let clock = NOW;
    const sync = service(store, url, provider, { now: () => clock });
    await sync.refresh(USER);
    await sync.tick();
    expect(store.completed).toHaveLength(0);
    expect(store.retried).toHaveLength(1);
    valid = true;
    clock = new Date(NOW.getTime() + 60_000);
    await sync.tick();
    expect(store.completed).toHaveLength(1);
  });

  it('pauses all deliveries to the same endpoint after a rate-limit response', async () => {
    let requests = 0;
    const url = await httpFixture((_body, _request, response) => {
      requests++;
      response.writeHead(429, { 'Retry-After': '120' }).end();
    });
    const store = new MemoryStore();
    const sync = service(store, url);
    await sync.refresh(USER);
    await sync.refresh('200000000000000002');
    store.pending.values().next().value!.item.attempts = 7;
    await sync.tick();
    await sync.tick();
    expect(requests).toBe(1);
    expect(store.completed).toHaveLength(0);
  });

  it.each([
    'http://web.invalid/api/integrations/discord/role-sync',
    'https://web.invalid/api/integrations/discord/role-sync?token=private',
    'https://web.invalid/other',
  ])('rejects unsafe configured delivery destinations: %s', (url) => {
    expect(() => service(new MemoryStore(), url)).toThrow('ROLE_SYNC_INVALID_CONFIG');
  });

  it('does not forward credentials through redirects and quarantines exhausted attempts', async () => {
    let forwarded = false;
    const target = await httpFixture((_body, _request, response) => {
      forwarded = true;
      response.writeHead(204).end();
    });
    const url = await httpFixture((_body, _request, response) =>
      response.writeHead(302, { Location: target }).end(),
    );
    const store = new MemoryStore();
    const sync = service(store, url);
    await sync.refresh(USER);
    await sync.tick();
    expect(forwarded).toBe(false);
    expect(store.failed[0]?.code).toBe('ROLE_SYNC_REDIRECT');
    const failing = await httpFixture((_body, _request, response) => response.writeHead(503).end());
    const retryStore = new MemoryStore();
    await retryStore.saveMembership(member());
    retryStore.pending.values().next().value!.item.attempts = 7;
    await service(retryStore, failing).tick();
    expect(retryStore.failed[0]?.code).toBe('ROLE_SYNC_ATTEMPTS_EXHAUSTED');
  });

  it('keeps delivery disabled and prevents overlapping sender ticks', async () => {
    let requests = 0;
    let release!: () => void;
    const url = await httpFixture((_body, _request, response) => {
      requests++;
      release = () => response.writeHead(204).end();
    });
    const store = new MemoryStore();
    await store.saveMembership(member());
    const disabled = new RoleSyncService(
      { guildId: GUILD, url, keyId: '', secret: '', enabled: false },
      store,
      provider,
    );
    await disabled.tick();
    expect(requests).toBe(0);
    const sync = service(store, url);
    const pending = sync.tick();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    await sync.tick();
    expect(requests).toBe(1);
    release();
    await pending;
  });
});
