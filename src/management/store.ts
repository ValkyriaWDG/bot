import type { Pool, PoolClient } from 'pg';
import type { BotConfig } from '../contracts.js';
import { initialManagementSettings, validateManagementSettings } from './settings.js';
import {
  ManagementError,
  type ManagementIdentity,
  type ManagementSettings,
  type ManagementSettingsSnapshot,
} from './types.js';

export class PostgresManagementStore {
  constructor(
    private pool: Pool,
    private config: BotConfig,
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '2000ms'");
      await client.query("SET LOCAL lock_timeout = '1500ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '8000ms'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async initialize(): Promise<void> {
    const initial = initialManagementSettings(this.config);
    await this.pool.query(
      'INSERT INTO management_settings(guild_id,settings) VALUES($1,$2) ON CONFLICT(guild_id) DO NOTHING',
      [this.config.guildId, JSON.stringify(initial.settings)],
    );
  }
  async readState(): Promise<{ desired: ManagementSettingsSnapshot; applyError: string | null }> {
    const result = await this.pool.query<{
      revision: string;
      settings: unknown;
      apply_error: string | null;
    }>('SELECT revision::text,settings,apply_error FROM management_settings WHERE guild_id=$1', [
      this.config.guildId,
    ]);
    const row = result.rows[0];
    if (!row) throw new ManagementError('MANAGEMENT_STORAGE_UNAVAILABLE', 503);
    return {
      desired: {
        revision: row.revision,
        settings: validateManagementSettings(row.settings, this.config),
      },
      applyError: row.apply_error,
    };
  }
  async readSettings(): Promise<ManagementSettingsSnapshot> {
    return (await this.readState()).desired;
  }
  async consume(identity: ManagementIdentity): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('DELETE FROM management_replay WHERE expires_at < clock_timestamp()');
      const result = await client.query(
        "INSERT INTO management_replay(guild_id,nonce,key_id,actor_id,method,path,body_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '10 minutes') ON CONFLICT DO NOTHING RETURNING nonce",
        [
          identity.actor.guildId,
          identity.nonce,
          identity.keyId,
          identity.actor.userId,
          identity.method,
          identity.path,
          identity.bodyDigest,
        ],
      );
      if (result.rowCount !== 1) throw new ManagementError('MANAGEMENT_REPLAY', 409);
    });
  }
  async audit(identity: ManagementIdentity, code: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO management_audit(guild_id,actor_id,key_id,capability,code) VALUES($1,$2,$3,$4,$5)',
      [identity.actor.guildId, identity.actor.userId, identity.keyId, identity.scope, code],
    );
  }
  async update(
    identity: ManagementIdentity,
    update: {
      expectedRevision: string;
      settings: ManagementSettings;
      reason: string;
      correlationId: string;
    },
    authorize: () => Promise<void>,
    assertActive: () => void = () => undefined,
  ): Promise<ManagementSettingsSnapshot> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<{ revision: string; settings: unknown }>(
          'SELECT revision::text,settings FROM management_settings WHERE guild_id=$1 FOR UPDATE',
          [this.config.guildId],
        )
      ).rows[0];
      if (!row) throw new ManagementError('MANAGEMENT_STORAGE_UNAVAILABLE', 503);
      if (row.revision !== update.expectedRevision)
        throw new ManagementError('MANAGEMENT_REVISION_CONFLICT', 409);
      await authorize();
      assertActive();
      const snapshot = { revision: String(BigInt(row.revision) + 1n), settings: update.settings };
      await client.query(
        'UPDATE management_settings SET revision=$2,settings=$3,apply_error=NULL,updated_at=clock_timestamp() WHERE guild_id=$1',
        [this.config.guildId, snapshot.revision, JSON.stringify(snapshot.settings)],
      );
      await client.query(
        'INSERT INTO management_audit(guild_id,actor_id,key_id,capability,code,correlation_id,reason,previous_revision,desired_revision,settings_before,settings_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          identity.actor.guildId,
          identity.actor.userId,
          identity.keyId,
          identity.scope,
          'MANAGEMENT_SETTINGS_UPDATED',
          update.correlationId,
          update.reason,
          row.revision,
          snapshot.revision,
          JSON.stringify(row.settings),
          JSON.stringify(snapshot.settings),
        ],
      );
      // Both statements may have waited on PostgreSQL. A deadline/shutdown during
      // either wait must roll back the desired value, not activate it on restart.
      assertActive();
      return snapshot;
    });
  }
  async applyFailed(revision: string): Promise<void> {
    await this.pool.query(
      "UPDATE management_settings SET apply_error='MANAGEMENT_APPLY_FAILED' WHERE guild_id=$1 AND revision=$2",
      [this.config.guildId, revision],
    );
  }
  async outboxStatus(): Promise<{
    pending: number;
    failed: number;
    lastDeliveredAt: string | null;
    oldestPendingAt: string | null;
  }> {
    const row = (
      await this.pool.query<{
        pending: number;
        failed: number;
        last_delivered: Date | null;
        oldest_pending: Date | null;
      }>(
        "SELECT count(*) FILTER (WHERE status IN ('pending','leased'))::int AS pending, count(*) FILTER (WHERE status='failed')::int AS failed, max(updated_at) FILTER (WHERE status='delivered') AS last_delivered, min(created_at) FILTER (WHERE status IN ('pending','leased')) AS oldest_pending FROM role_outbox WHERE event->>'guildId'=$1",
        [this.config.guildId],
      )
    ).rows[0]!;
    return {
      pending: row.pending,
      failed: row.failed,
      lastDeliveredAt: row.last_delivered?.toISOString() ?? null,
      oldestPendingAt: row.oldest_pending?.toISOString() ?? null,
    };
  }
}
