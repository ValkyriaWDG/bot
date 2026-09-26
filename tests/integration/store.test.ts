import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../src/persistence/migrations.js';
import { PostgresStore } from '../../src/persistence/store.js';
import type { Intent, Membership } from '../../src/contracts.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'TEST_DATABASE_URL must name a disposable PostgreSQL database; integration tests are not skipped.',
  );
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 });
const guildId = '111111111111111111';
const actor = { guildId, userId: '222222222222222222' };
const store = new PostgresStore(pool, guildId);
const intent = (): Intent => ({
  ...actor,
  id: randomUUID(),
  interactionId: randomUUID(),
  serverId: 'primary',
  action: { type: 'restart' },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  state: 'pending',
});

describe('real PostgreSQL transaction boundaries', () => {
  beforeAll(async () => {
    await migrate(pool);
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE audit_events,action_intents,memberships,role_outbox RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await pool.end();
  });
  it('two concurrent confirmations dispatch only one action with atomic audit', async () => {
    const row = intent();
    await store.createIntent(row);
    const outcomes = await Promise.all([
      store.claimIntent(row.id, actor, new Date()),
      store.claimIntent(row.id, actor, new Date()),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(
      (
        await pool.query(
          "SELECT code FROM audit_events WHERE intent_id=$1 AND code='dispatching'",
          [row.id],
        )
      ).rowCount,
    ).toBe(1);
    expect((await store.getIntent(row.id))?.state).toBe('executing');
  });
  it('serializes different intents for the same server and marks abandoned execution unknown', async () => {
    const a = intent(),
      b = intent();
    await store.createIntent(a);
    await store.createIntent(b);
    expect(await store.claimIntent(a.id, actor, new Date())).toBe(true);
    expect(await store.claimIntent(b.id, actor, new Date())).toBe(false);
    expect(await store.recoverInterrupted()).toBe(1);
    expect((await store.getIntent(a.id))?.state).toBe('unknown');
    await expect(store.claimIntent(a.id, actor, new Date())).resolves.toBe(false);
  });
  it('rejects cross-actor and expired claims and duplicate initial interaction', async () => {
    const row = intent();
    await store.createIntent(row);
    expect(await store.createIntent({ ...row, id: randomUUID() })).toBe(false);
    expect(
      await store.claimIntent(row.id, { ...actor, userId: '333333333333333333' }, new Date()),
    ).toBe(false);
    expect(await store.claimIntent(row.id, actor, new Date(Date.now() + 61_000))).toBe(false);
  });
  it('persists immutable ordered outbox records and leases each delivery once', async () => {
    const member: Membership = {
      ...actor,
      roleIds: ['333333333333333333'],
      state: 'present',
      observedAt: new Date().toISOString(),
    };
    const first = await store.saveMembership(member);
    const second = await store.saveMembership({
      ...member,
      roleIds: [],
      state: 'left',
      observedAt: new Date(Date.now() + 1).toISOString(),
    });
    expect(BigInt(second.sequence) > BigInt(first.sequence)).toBe(true);
    const claims = await Promise.all([
      store.claimOutbox(new Date(Date.now() + 10), 10),
      store.claimOutbox(new Date(Date.now() + 10), 10),
    ]);
    expect(claims.flat()).toHaveLength(2);
    const item = claims.flat()[0]!;
    await store.completeOutbox(item.event.eventId, randomUUID());
    expect(
      (await pool.query('SELECT status FROM role_outbox WHERE event_id=$1', [item.event.eventId]))
        .rows[0].status,
    ).toBe('leased');
    await store.completeOutbox(item.event.eventId, item.leaseId);
    expect(
      (
        await pool.query('SELECT status,event FROM role_outbox WHERE event_id=$1', [
          item.event.eventId,
        ])
      ).rows[0],
    ).toEqual({ status: 'delivered', event: item.event });
    expect(await store.trackedMembers(10)).toEqual([actor.userId]);
  });
  it('rejects older observations and keeps failed outbox messages for inspection', async () => {
    const now = new Date();
    const event = await store.saveMembership({
      ...actor,
      roleIds: [],
      state: 'left',
      observedAt: now.toISOString(),
    });
    await expect(
      store.saveMembership({
        ...actor,
        roleIds: ['333333333333333333'],
        state: 'present',
        observedAt: new Date(now.getTime() - 1000).toISOString(),
      }),
    ).rejects.toThrow('stale_observation');
    const claimed = (await store.claimOutbox(new Date(now.getTime() + 10), 1))[0]!;
    await store.failOutbox(event.eventId, claimed.leaseId, 'unauthorized');
    expect(await store.claimOutbox(new Date(now.getTime() + 1_000_000), 10)).toEqual([]);
    expect(
      (
        await pool.query('SELECT status,last_code FROM role_outbox WHERE event_id=$1', [
          event.eventId,
        ])
      ).rows[0],
    ).toEqual({ status: 'failed', last_code: 'unauthorized' });
  });
  it('one runtime lease prevents another process from recovering live actions', async () => {
    const release = await store.acquireRuntimeLease();
    await expect(store.acquireRuntimeLease()).rejects.toThrow('runtime_already_active');
    await release();
    const second = await store.acquireRuntimeLease();
    await second();
  });
});
