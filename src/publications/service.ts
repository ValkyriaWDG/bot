import {
  destinationSchema,
  parseMatchProjection,
  parsePublicationEvent,
  publicationNonce,
  type MatchProjection,
  type PublicationDestination,
  type PublicationEvent,
  type PublicationJob,
  type PublicationStore,
  type PublicationTransport,
  type WebsitePublicationSource,
} from './contracts.js';
import { renderMatch, renderStatus } from './render.js';
import { PublicationTransportError } from './transport.js';

export interface PublicationServiceOptions {
  store: PublicationStore;
  transport: PublicationTransport;
  source: WebsitePublicationSource;
  destinations: PublicationDestination[];
  enabled: boolean;
  websiteOrigin: string;
  now?: () => Date;
  authorizeDestination: (destination: PublicationDestination) => Promise<boolean>;
  signupEnabled?: boolean;
}
export class PublicationService {
  private sending = false;
  private readonly now: () => Date;
  private blockedUntil = 0;
  constructor(private readonly options: PublicationServiceOptions) {
    this.now = options.now ?? (() => new Date());
    const u = new URL(options.websiteOrigin);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/'
    )
      throw new Error('publication_invalid_origin');
    options.destinations.forEach((d) => destinationSchema.parse(d));
    if (
      options.destinations.length > 75 ||
      new Set(
        options.destinations.map((d) => `${d.guildId}:${d.channelId}:${d.locale}:${d.purpose}`),
      ).size !== options.destinations.length
    )
      throw new Error('publication_invalid_destinations');
  }
  accept(event: PublicationEvent) {
    return this.options.store.ingest(parsePublicationEvent(event), this.options.destinations);
  }
  recover() {
    return this.options.store.recover();
  }
  async tick(): Promise<void> {
    if (!this.options.enabled || this.sending || this.now().getTime() < this.blockedUntil) return;
    this.sending = true;
    try {
      const job = await this.options.store.claim(this.now());
      if (!job) return;
      if (
        !this.options.destinations.some(
          (d) =>
            d.guildId === job.guildId &&
            d.channelId === job.channelId &&
            d.locale === job.locale &&
            d.purpose === job.purpose,
        )
      ) {
        await this.options.store.finish(job, job.desiredRevision, 'failed', 'destination_removed');
        return;
      }
      await this.deliver(job);
    } finally {
      this.sending = false;
    }
  }
  private async deliver(job: PublicationJob): Promise<void> {
    let p = job.projection;
    if (job.purpose !== 'status') {
      try {
        p = parseMatchProjection(await this.options.source.latest(job.entityId, job.locale));
        if (
          p.publication === 'published' &&
          new URL(p.publicUrl).origin !== new URL(this.options.websiteOrigin).origin
        )
          throw new Error('publication_origin_mismatch');
        if (!(await this.options.store.refresh(job, p))) {
          await this.retry(job, 'canonical_behind');
          return;
        }
        job.desiredRevision = p.revision;
      } catch {
        await this.retry(job, 'canonical_unavailable');
        return;
      }
    }
    let body;
    if (job.purpose === 'status') {
      if (!('kind' in p) || p.kind !== 'status') {
        await this.options.store.finish(job, job.desiredRevision, 'failed', 'invalid_projection');
        return;
      }
      body = renderStatus(p, this.now());
    } else {
      if ('kind' in p) {
        await this.options.store.finish(job, job.desiredRevision, 'failed', 'invalid_projection');
        return;
      }
      body = renderMatch(p, job.purpose, false, { resultUpdate: job.messageId !== null });
      const withdrawn = p.publication === 'withdrawn';
      if (!job.messageId && (withdrawn || body === null)) {
        await this.options.store.finish(job, job.desiredRevision, 'suppressed', 'not_publishable');
        return;
      }
      if (body === null)
        body = renderMatch(
          {
            schemaVersion: 1,
            matchId: p.matchId,
            publicationId: p.publicationId,
            revision: p.revision,
            locale: p.locale,
            publication: 'withdrawn',
          },
          job.purpose,
          false,
        )!;
    }
    try {
      if (!(await this.options.authorizeDestination(job))) {
        await this.options.store.finish(job, job.desiredRevision, 'failed', 'destination_denied');
        return;
      }
    } catch {
      await this.retry(job, 'destination_unavailable');
      return;
    }
    if (!(await this.options.store.beginAttempt(job, job.desiredRevision))) {
      await this.retry(job, 'superseded');
      return;
    }
    try {
      if (!job.messageId) {
        const id = await this.options.transport.create(
          job.channelId,
          body,
          publicationNonce(job.id),
        );
        // Do not retry creation if Discord accepted it but this persistence fails.
        await this.options.store.saveMessageId(job, id);
        job.messageId = id;
      } else await this.options.transport.edit(job.channelId, job.messageId, body);
    } catch (error) {
      await this.transportFailure(job, error);
      return;
    }
    if (
      this.options.signupEnabled === true &&
      job.purpose === 'fixture' &&
      !('kind' in p) &&
      p.publication === 'published' &&
      p.signup === 'open'
    ) {
      try {
        await this.options.source.bindPublication({
          schemaVersion: 1,
          publicationId: p.publicationId,
          matchId: p.matchId,
          revision: p.revision,
          guildId: job.guildId,
          channelId: job.channelId,
          messageId: job.messageId!,
          locale: job.locale,
        });
      } catch {
        await this.retry(job, 'binding_unavailable');
        return;
      }
      // Recheck after binding I/O as the canonical match may have been cancelled meanwhile.
      let latest: MatchProjection;
      try {
        latest = parseMatchProjection(await this.options.source.latest(job.entityId, job.locale));
        if (JSON.stringify(latest) !== JSON.stringify(p)) {
          await this.retry(job, 'superseded');
          return;
        }
      } catch {
        await this.retry(job, 'canonical_unavailable');
        return;
      }
      try {
        if (!(await this.options.authorizeDestination(job))) {
          await this.options.store.finish(job, job.desiredRevision, 'failed', 'destination_denied');
          return;
        }
      } catch {
        await this.retry(job, 'destination_unavailable');
        return;
      }
      // Binding, canonical reads and channel authorization await external I/O. A newer
      // event or lost attempt lease must fence the final controls edit as well.
      if (!(await this.options.store.canEnableControls(job, job.desiredRevision))) {
        await this.retry(job, 'superseded');
        return;
      }
      try {
        await this.options.transport.edit(
          job.channelId,
          job.messageId!,
          renderMatch(latest, 'fixture', true)!,
        );
      } catch (error) {
        await this.transportFailure(job, error);
        return;
      }
    }
    await this.options.store.finish(job, job.desiredRevision, 'delivered', 'delivered');
  }
  private async transportFailure(job: PublicationJob, error: unknown): Promise<void> {
    const code = error instanceof PublicationTransportError ? error.code : 'uncertain';
    if (code === 'rate_limited') {
      const hint = error instanceof PublicationTransportError ? error.retryAfterMs : 1000;
      if (!Number.isFinite(hint) || hint > 86_400_000) {
        await this.options.store.finish(job, job.desiredRevision, 'failed', 'invalid_retry');
        return;
      }
      this.blockedUntil = Math.max(this.blockedUntil, this.now().getTime() + hint);
      await this.retry(job, 'rate_limited', hint);
      return;
    }
    if (code === 'uncertain') {
      if (job.messageId) {
        await this.retry(job, 'edit_uncertain');
        return;
      }
      await this.options.store.finish(job, job.desiredRevision, 'unknown', 'create_unknown');
      return;
    }
    await this.options.store.finish(job, job.desiredRevision, 'failed', code);
  }
  private async retry(job: PublicationJob, code: string, delayMs = 0): Promise<void> {
    if (job.attempts >= 8) {
      await this.options.store.finish(job, job.desiredRevision, 'failed', 'attempts_exhausted');
      return;
    }
    const delay = Math.max(delayMs, Math.min(3_600_000, 1000 * 2 ** job.attempts));
    await this.options.store.retry(job, new Date(this.now().getTime() + delay), code);
  }
}
