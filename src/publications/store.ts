import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  destinationSchema,
  digest,
  parseMatchProjection,
  parsePublicationEvent,
  type MatchProjection,
  type PublicationDestination,
  type PublicationEvent,
  type PublicationJob,
  type PublicationStore,
  type StatusProjection,
  type StoredProjection,
} from './contracts.js';

type Row = {
  id: string;
  guild_id: string;
  entity_id: string;
  channel_id: string;
  locale: 'cs' | 'en';
  purpose: PublicationDestination['purpose'];
  desired_revision: string;
  message_id: string | null;
  lease_id: string;
  attempts: number;
  projection: StoredProjection;
};
const jobFrom = (r: Row): PublicationJob => ({
  id: r.id,
  guildId: r.guild_id,
  entityId: r.entity_id,
  channelId: r.channel_id,
  locale: r.locale,
  purpose: r.purpose,
  desiredRevision: r.desired_revision,
  messageId: r.message_id,
  leaseId: r.lease_id,
  attempts: r.attempts,
  projection: r.projection,
});
const safeCode = (code: string) => (/^[a-z_]{1,64}$/.test(code) ? code : 'unclassified');

export class PostgresPublicationStore implements PublicationStore {
  constructor(
    private readonly pool: Pool,
    private readonly guildId: string,
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='5s'");
      await c.query("SET LOCAL lock_timeout='2s'");
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
    }
  }
  private lock(c: PoolClient, entityId: string, locale: string) {
    return c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `publication:${this.guildId}:${entityId}:${locale}`,
    ]);
  }
  private async saveProjection(
    c: PoolClient,
    p: MatchProjection,
  ): Promise<'accepted' | 'stale' | 'same'> {
    const old = (
      await c.query<{ revision: string; digest: string }>(
        'SELECT revision,digest FROM publication_projections WHERE guild_id=$1 AND entity_id=$2 AND locale=$3 FOR UPDATE',
        [this.guildId, p.matchId, p.locale],
      )
    ).rows[0];
    const hash = digest(p);
    if (old && BigInt(old.revision) > BigInt(p.revision)) return 'stale';
    if (old && old.revision === p.revision) {
      if (old.digest !== hash) throw new Error('publication_revision_conflict');
      return 'same';
    }
    await c.query(
      'INSERT INTO publication_projections(guild_id,entity_id,locale,revision,digest,projection) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id,entity_id,locale) DO UPDATE SET revision=excluded.revision,digest=excluded.digest,projection=excluded.projection',
      [this.guildId, p.matchId, p.locale, p.revision, hash, JSON.stringify(p)],
    );
    await c.query(
      "UPDATE publication_bindings SET desired_revision=$4,state=CASE WHEN state IN ('delivered','suppressed','failed') THEN 'pending' ELSE state END,attempts=CASE WHEN state IN ('delivered','suppressed','failed','pending') THEN 0 ELSE attempts END,next_attempt_at=now(),updated_at=now() WHERE guild_id=$1 AND entity_id=$2 AND locale=$3",
      [this.guildId, p.matchId, p.locale, p.revision],
    );
    return 'accepted';
  }
  async ingest(
    input: PublicationEvent,
    destinations: PublicationDestination[],
  ): Promise<'accepted' | 'duplicate' | 'stale'> {
    const event = parsePublicationEvent(input);
    if (event.guildId !== this.guildId) throw new Error('publication_wrong_guild');
    const targets = destinations.map((d) => destinationSchema.parse(d));
    if (targets.some((d) => d.guildId !== this.guildId)) throw new Error('publication_wrong_guild');
    return this.transaction(async (c) => {
      const inserted = await c.query(
        'INSERT INTO publication_receipts(guild_id,event_id,digest) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id',
        [this.guildId, event.eventId, digest(event)],
      );
      if (!inserted.rowCount) {
        const old = (
          await c.query<{ digest: string }>(
            'SELECT digest FROM publication_receipts WHERE guild_id=$1 AND event_id=$2',
            [this.guildId, event.eventId],
          )
        ).rows[0]!;
        if (old.digest !== digest(event)) throw new Error('publication_event_conflict');
        return 'duplicate';
      }
      const p = event.projection;
      await this.lock(c, p.matchId, p.locale);
      if ((await this.saveProjection(c, p)) === 'stale') return 'stale';
      for (const d of targets.filter((d) => d.locale === p.locale && d.purpose !== 'status')) {
        await c.query(
          "INSERT INTO publication_bindings(id,guild_id,entity_id,locale,purpose,channel_id,desired_revision,state) VALUES($1,$2,$3,$4,$5,$6,$7,'pending') ON CONFLICT(guild_id,entity_id,locale,purpose,channel_id) DO NOTHING",
          [randomUUID(), this.guildId, p.matchId, d.locale, d.purpose, d.channelId, p.revision],
        );
      }
      return 'accepted';
    });
  }
  async claim(now: Date): Promise<PublicationJob | null> {
    return this.transaction(async (c) => {
      const row = (
        await c.query<Row>(
          "SELECT b.*,p.projection FROM publication_bindings b JOIN publication_projections p USING(guild_id,entity_id,locale) WHERE b.guild_id=$1 AND ((b.state='pending' AND b.next_attempt_at<=$2) OR (b.state='leased' AND b.lease_until<=$2)) ORDER BY b.next_attempt_at,b.id LIMIT 1 FOR UPDATE OF b SKIP LOCKED",
          [this.guildId, now],
        )
      ).rows[0];
      if (!row) return null;
      const leaseId = randomUUID();
      await c.query(
        "UPDATE publication_bindings SET state='leased',lease_id=$2,lease_until=$3,attempts=attempts+1,updated_at=now() WHERE id=$1",
        [row.id, leaseId, new Date(now.getTime() + 120_000)],
      );
      return jobFrom({ ...row, lease_id: leaseId, attempts: row.attempts + 1 });
    });
  }
  async refresh(job: PublicationJob, input: MatchProjection): Promise<boolean> {
    const p = parseMatchProjection(input);
    if (p.matchId !== job.entityId || p.locale !== job.locale || job.guildId !== this.guildId)
      throw new Error('publication_projection_mismatch');
    return this.transaction(async (c) => {
      await this.lock(c, p.matchId, p.locale);
      if ((await this.saveProjection(c, p)) === 'stale') return false;
      return Boolean(
        (
          await c.query(
            "SELECT 1 FROM publication_bindings WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state='leased' AND desired_revision=$4",
            [job.id, this.guildId, job.leaseId, p.revision],
          )
        ).rowCount,
      );
    });
  }
  async beginAttempt(job: PublicationJob, revision: string): Promise<boolean> {
    return this.transaction(async (c) => {
      const result = await c.query(
        "UPDATE publication_bindings SET state='sending',updated_at=now() WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state='leased' AND desired_revision=$4 RETURNING id",
        [job.id, this.guildId, job.leaseId, revision],
      );
      if (!result.rowCount) return false;
      await c.query('INSERT INTO publication_audit(binding_id,code) VALUES($1,$2)', [
        job.id,
        job.messageId ? 'edit_attempted' : 'create_attempted',
      ]);
      return true;
    });
  }
  async canEnableControls(job: PublicationJob, revision: string): Promise<boolean> {
    if (!job.messageId || job.purpose !== 'fixture') return false;
    return Boolean(
      (
        await this.pool.query(
          "SELECT 1 FROM publication_bindings WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state='sending' AND desired_revision=$4 AND message_id=$5 AND purpose='fixture'",
          [job.id, this.guildId, job.leaseId, revision, job.messageId],
        )
      ).rowCount,
    );
  }
  async saveMessageId(job: PublicationJob, messageId: string): Promise<void> {
    if (!/^[1-9][0-9]{16,19}$/.test(messageId)) throw new Error('publication_invalid_message');
    const r = await this.pool.query(
      "UPDATE publication_bindings SET message_id=$4,updated_at=now() WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state='sending' AND message_id IS NULL",
      [job.id, this.guildId, job.leaseId, messageId],
    );
    if (!r.rowCount) throw new Error('publication_lease_lost');
  }
  async finish(
    job: PublicationJob,
    revision: string,
    state: 'delivered' | 'suppressed' | 'unknown' | 'failed',
    code: string,
  ): Promise<void> {
    await this.transaction(async (c) => {
      const r = await c.query(
        "UPDATE publication_bindings SET state=CASE WHEN $4 IN ('delivered','suppressed') AND desired_revision>$5 THEN 'pending' ELSE $4 END,delivered_revision=CASE WHEN $4='delivered' THEN $5 ELSE delivered_revision END,lease_id=NULL,lease_until=NULL,last_code=$6,updated_at=now() WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state IN ('leased','sending') RETURNING id",
        [job.id, this.guildId, job.leaseId, state, revision, safeCode(code)],
      );
      if (!r.rowCount) throw new Error('publication_lease_lost');
      await c.query('INSERT INTO publication_audit(binding_id,code) VALUES($1,$2)', [
        job.id,
        safeCode(code),
      ]);
    });
  }
  async retry(job: PublicationJob, nextAttempt: Date, code: string): Promise<void> {
    const r = await this.pool.query(
      "UPDATE publication_bindings SET state='pending',lease_id=NULL,lease_until=NULL,next_attempt_at=$4,last_code=$5,updated_at=now() WHERE id=$1 AND guild_id=$2 AND lease_id=$3 AND state IN ('leased','sending')",
      [job.id, this.guildId, job.leaseId, nextAttempt, safeCode(code)],
    );
    if (!r.rowCount) throw new Error('publication_lease_lost');
  }
  async recover(): Promise<number> {
    return this.transaction(async (c) => {
      const rows = (
        await c.query<{ id: string }>(
          "UPDATE publication_bindings SET state=CASE WHEN state='sending' AND message_id IS NULL THEN 'unknown' ELSE 'pending' END,lease_id=NULL,lease_until=NULL,last_code='process_interrupted',next_attempt_at=now(),updated_at=now() WHERE guild_id=$1 AND state IN ('leased','sending') RETURNING id",
          [this.guildId],
        )
      ).rows;
      for (const row of rows)
        await c.query('INSERT INTO publication_audit(binding_id,code) VALUES($1,$2)', [
          row.id,
          'process_interrupted',
        ]);
      return rows.length;
    });
  }
  async status(serverId: string, locale: 'cs' | 'en'): Promise<StatusProjection | null> {
    return (
      (
        await this.pool.query<{ projection: StatusProjection }>(
          'SELECT projection FROM publication_projections WHERE guild_id=$1 AND entity_id=$2 AND locale=$3',
          [this.guildId, `server:${serverId}`, locale],
        )
      ).rows[0]?.projection ?? null
    );
  }
  async observeStatus(
    destination: PublicationDestination,
    p: StatusProjection,
    heartbeatMs: number,
    now: Date,
  ): Promise<boolean> {
    const d = destinationSchema.parse(destination);
    if (d.guildId !== this.guildId || d.purpose !== 'status' || d.locale !== p.locale)
      throw new Error('publication_wrong_destination');
    return this.transaction(async (c) => {
      const entityId = `server:${p.serverId}`;
      await this.lock(c, entityId, p.locale);
      const old = (
        await c.query<{ revision: string; projection: StatusProjection; last_emitted_at: Date }>(
          'SELECT revision,projection,last_emitted_at FROM publication_projections WHERE guild_id=$1 AND entity_id=$2 AND locale=$3 FOR UPDATE',
          [this.guildId, entityId, p.locale],
        )
      ).rows[0];
      const same =
        old &&
        digest({
          sample: old.projection.sample,
          state: old.projection.state,
          label: old.projection.label,
        }) === digest({ sample: p.sample, state: p.state, label: p.label });
      const emit = !same || now.getTime() - old.last_emitted_at.getTime() >= heartbeatMs;
      const rev = old ? (BigInt(old.revision) + (emit ? 1n : 0n)).toString() : '1';
      await c.query(
        'INSERT INTO publication_projections(guild_id,entity_id,locale,revision,digest,projection,last_emitted_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(guild_id,entity_id,locale) DO UPDATE SET revision=excluded.revision,digest=excluded.digest,projection=excluded.projection,last_emitted_at=excluded.last_emitted_at',
        [
          this.guildId,
          entityId,
          p.locale,
          rev,
          digest(p),
          JSON.stringify(p),
          emit ? now : old!.last_emitted_at,
        ],
      );
      await c.query(
        "INSERT INTO publication_bindings(id,guild_id,entity_id,locale,purpose,channel_id,desired_revision,state,next_attempt_at) VALUES($1,$2,$3,$4,'status',$5,$6,'pending',$7) ON CONFLICT(guild_id,entity_id,locale,purpose,channel_id) DO NOTHING",
        [randomUUID(), this.guildId, entityId, p.locale, d.channelId, rev, now],
      );
      if (emit)
        await c.query(
          "UPDATE publication_bindings SET desired_revision=$4,state=CASE WHEN state IN ('delivered','suppressed','failed') THEN 'pending' ELSE state END,attempts=CASE WHEN state IN ('delivered','suppressed','failed','pending') THEN 0 ELSE attempts END,next_attempt_at=$5,updated_at=now() WHERE guild_id=$1 AND entity_id=$2 AND locale=$3",
          [this.guildId, entityId, p.locale, rev, now],
        );
      return emit;
    });
  }
}
