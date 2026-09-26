import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  ActionStore,
  Actor,
  Intent,
  Membership,
  OutboxItem,
  RoleSyncEvent,
  SyncStore,
} from '../contracts.js';
import { snowflake } from '../config.js';

type IntentRow = {
  id: string;
  interaction_id: string;
  guild_id: string;
  user_id: string;
  server_id: string;
  action: Intent['action'];
  expires_at: Date;
  state: Intent['state'];
};
const fromRow = (row: IntentRow): Intent => ({
  id: row.id,
  interactionId: row.interaction_id,
  guildId: row.guild_id,
  userId: row.user_id,
  serverId: row.server_id,
  action: row.action,
  expiresAt: row.expires_at.toISOString(),
  state: row.state,
});
const safeCode = (code: string) => (/^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : 'unclassified');

export class PostgresStore implements ActionStore, SyncStore {
  constructor(
    private pool: Pool,
    private guildId: string,
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='2s'");
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
  private checkActor(actor: Actor) {
    if (actor.guildId !== this.guildId || !snowflake.safeParse(actor.userId).success)
      throw new Error('invalid_actor');
  }
  async createIntent(intent: Intent) {
    this.checkActor(intent);
    return this.transaction(async (client) => {
      const result = await client.query(
        'INSERT INTO action_intents(id,interaction_id,guild_id,user_id,server_id,action,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(interaction_id) DO NOTHING RETURNING id',
        [
          intent.id,
          intent.interactionId,
          intent.guildId,
          intent.userId,
          intent.serverId,
          JSON.stringify(intent.action),
          intent.expiresAt,
          'pending',
        ],
      );
      if (!result.rowCount) return false;
      await client.query(
        'INSERT INTO audit_events(guild_id,user_id,server_id,action,code,intent_id) VALUES($1,$2,$3,$4,$5,$6)',
        [intent.guildId, intent.userId, intent.serverId, intent.action.type, 'prepared', intent.id],
      );
      return true;
    });
  }
  async getIntent(id: string): Promise<Intent | null> {
    const row = (
      await this.pool.query<IntentRow>('SELECT * FROM action_intents WHERE id=$1 AND guild_id=$2', [
        id,
        this.guildId,
      ])
    ).rows[0];
    return row ? fromRow(row) : null;
  }
  async claimIntent(id: string, actor: Actor, now: Date) {
    this.checkActor(actor);
    return this.transaction(async (client) => {
      const row = (
        await client.query<IntentRow>(
          "SELECT * FROM action_intents WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND state='pending' AND expires_at>$4 FOR UPDATE",
          [id, actor.guildId, actor.userId, now],
        )
      ).rows[0];
      if (!row) return false;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `server:${row.guild_id}:${row.server_id}`,
      ]);
      if (
        (
          await client.query(
            "SELECT 1 FROM action_intents WHERE server_id=$1 AND state='executing'",
            [row.server_id],
          )
        ).rowCount
      )
        return false;
      const claimed = await client.query(
        "UPDATE action_intents SET state='executing',updated_at=now() WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id",
        [id],
      );
      if (!claimed.rowCount) return false;
      await client.query(
        'INSERT INTO audit_events(guild_id,user_id,server_id,action,code,intent_id) VALUES($1,$2,$3,$4,$5,$6)',
        [row.guild_id, row.user_id, row.server_id, row.action.type, 'dispatching', id],
      );
      return true;
    });
  }
  async finishIntent(id: string, state: 'succeeded' | 'failed' | 'unknown', code: string) {
    await this.transaction(async (client) => {
      const row = (
        await client.query<IntentRow>(
          "UPDATE action_intents SET state=$1,updated_at=now() WHERE id=$2 AND guild_id=$3 AND state='executing' RETURNING *",
          [state, id, this.guildId],
        )
      ).rows[0];
      if (!row) throw new Error('invalid_transition');
      await client.query(
        'INSERT INTO audit_events(guild_id,user_id,server_id,action,code,intent_id) VALUES($1,$2,$3,$4,$5,$6)',
        [row.guild_id, row.user_id, row.server_id, row.action.type, safeCode(code), id],
      );
    });
  }
  async cancelIntent(id: string, actor: Actor) {
    this.checkActor(actor);
    return this.transaction(async (client) => {
      const row = (
        await client.query<IntentRow>(
          "UPDATE action_intents SET state='cancelled',updated_at=now() WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND state='pending' RETURNING *",
          [id, actor.guildId, actor.userId],
        )
      ).rows[0];
      if (!row) return false;
      await client.query(
        'INSERT INTO audit_events(guild_id,user_id,server_id,action,code,intent_id) VALUES($1,$2,$3,$4,$5,$6)',
        [row.guild_id, row.user_id, row.server_id, row.action.type, 'cancelled', id],
      );
      return true;
    });
  }
  async audit(actor: Actor, action: string, serverId: string | null, code: string) {
    this.checkActor(actor);
    await this.pool.query(
      'INSERT INTO audit_events(guild_id,user_id,server_id,action,code) VALUES($1,$2,$3,$4,$5)',
      [actor.guildId, actor.userId, serverId, action, safeCode(code)],
    );
  }
  async acquireRuntimeLease(onLost?: () => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [`runtime:${this.guildId}`],
      );
      if (!result.rows[0]?.locked) throw new Error('runtime_already_active');
    } catch (error) {
      client.release();
      throw error;
    }
    const lost = () => onLost?.();
    client.on('error', lost);
    return async () => {
      client.removeListener('error', lost);
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [`runtime:${this.guildId}`])
        .catch(() => undefined);
      client.release(true);
    };
  }
  async recoverInterrupted() {
    return this.transaction(async (client) => {
      const rows = (
        await client.query<IntentRow>(
          "UPDATE action_intents SET state='unknown',updated_at=now() WHERE guild_id=$1 AND state='executing' RETURNING *",
          [this.guildId],
        )
      ).rows;
      for (const row of rows)
        await client.query(
          'INSERT INTO audit_events(guild_id,user_id,server_id,action,code,intent_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            row.guild_id,
            row.user_id,
            row.server_id,
            row.action.type,
            'process_interrupted',
            row.id,
          ],
        );
      return rows.length;
    });
  }
  async saveMembership(member: Membership): Promise<RoleSyncEvent> {
    this.checkActor(member);
    if (
      !['present', 'left'].includes(member.state) ||
      !Number.isFinite(Date.parse(member.observedAt)) ||
      member.roleIds.length > 250 ||
      member.roleIds.some((role) => !snowflake.safeParse(role).success) ||
      new Set(member.roleIds).size !== member.roleIds.length ||
      (member.state === 'left' && member.roleIds.length !== 0)
    )
      throw new Error('invalid_membership');
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `member:${member.guildId}:${member.userId}`,
      ]);
      const row = (
        await client.query<{ observed_at: Date }>(
          'SELECT observed_at FROM memberships WHERE guild_id=$1 AND user_id=$2',
          [member.guildId, member.userId],
        )
      ).rows[0];
      if (row && row.observed_at > new Date(member.observedAt))
        throw new Error('stale_observation');
      const sequence = (
        await client.query<{ value: string }>("SELECT nextval('role_sync_sequence')::text AS value")
      ).rows[0]!.value;
      const event: RoleSyncEvent = {
        schemaVersion: 1,
        eventId: randomUUID(),
        guildId: member.guildId,
        userId: member.userId,
        roleIds: [...member.roleIds],
        membershipState: member.state,
        observedAt: member.observedAt,
        sequence,
      };
      await client.query(
        'INSERT INTO memberships(guild_id,user_id,role_ids,membership_state,observed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id,user_id) DO UPDATE SET role_ids=excluded.role_ids,membership_state=excluded.membership_state,observed_at=excluded.observed_at',
        [
          member.guildId,
          member.userId,
          JSON.stringify(member.roleIds),
          member.state,
          member.observedAt,
        ],
      );
      await client.query('INSERT INTO role_outbox(event_id,sequence,event) VALUES($1,$2,$3)', [
        event.eventId,
        sequence,
        JSON.stringify(event),
      ]);
      return event;
    });
  }
  async trackedMembers(limit: number, afterUserId = '') {
    const result = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE guild_id=$1 AND user_id>$2 ORDER BY user_id LIMIT $3',
      [this.guildId, afterUserId, Math.min(500, Math.max(1, limit))],
    );
    return result.rows.map((row) => row.user_id);
  }
  async claimOutbox(now: Date, limit: number): Promise<OutboxItem[]> {
    return this.transaction(async (client) => {
      const rows = (
        await client.query<{ event_id: string; event: RoleSyncEvent; attempts: number }>(
          "SELECT event_id,event,attempts FROM role_outbox WHERE event->>'guildId'=$1 AND ((status='pending' AND next_attempt_at<=$2) OR (status='leased' AND lease_until<=$2)) ORDER BY sequence LIMIT $3 FOR UPDATE SKIP LOCKED",
          [this.guildId, now, Math.min(20, Math.max(1, limit))],
        )
      ).rows;
      const results: OutboxItem[] = [];
      for (const row of rows) {
        const leaseId = randomUUID();
        await client.query(
          "UPDATE role_outbox SET status='leased',attempts=attempts+1,lease_id=$1,lease_until=$2,updated_at=now() WHERE event_id=$3",
          [leaseId, new Date(now.getTime() + 120_000), row.event_id],
        );
        results.push({ event: row.event, attempts: row.attempts + 1, leaseId });
      }
      return results;
    });
  }
  async completeOutbox(id: string, leaseId: string) {
    await this.pool.query(
      "UPDATE role_outbox SET status='delivered',lease_id=NULL,lease_until=NULL,last_code='delivered',updated_at=now() WHERE event_id=$1 AND lease_id=$2 AND status='leased'",
      [id, leaseId],
    );
  }
  async retryOutbox(id: string, leaseId: string, nextAttempt: Date, code: string) {
    await this.pool.query(
      "UPDATE role_outbox SET status='pending',lease_id=NULL,lease_until=NULL,next_attempt_at=$3,last_code=$4,updated_at=now() WHERE event_id=$1 AND lease_id=$2 AND status='leased'",
      [id, leaseId, nextAttempt, safeCode(code)],
    );
  }
  async failOutbox(id: string, leaseId: string, code: string) {
    await this.pool.query(
      "UPDATE role_outbox SET status='failed',lease_id=NULL,lease_until=NULL,last_code=$3,updated_at=now() WHERE event_id=$1 AND lease_id=$2 AND status='leased'",
      [id, leaseId, safeCode(code)],
    );
  }
}
