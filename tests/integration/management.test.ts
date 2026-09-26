import { randomUUID } from 'node:crypto';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/persistence/migrations.js';
import { PostgresStore } from '../../src/persistence/store.js';
import type { BotConfig, Membership } from '../../src/contracts.js';
import {
  createManagementServer,
  closeManagementServer,
  PostgresManagementStore,
  signManagementRequest,
  type ManagementRuntime,
  type ManagementSettingsSnapshot,
} from '../../src/management/index.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must name a verified disposable PostgreSQL database.');
const schema = `management_test_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 8,
});
const guildId = '111111111111111111',
  userId = '222222222222222222',
  role = '333333333333333333';
const secret = 'synthetic-management-service-key-00000000000000';
const botConfig: BotConfig = {
  guildId,
  applicationId: '444444444444444444',
  defaultLocale: 'cs',
  websiteUrl: 'https://website.invalid',
  servers: [
    {
      id: 'primary',
      label: 'Original',
      baseUrl: 'https://private-provider.invalid',
      tokenEnv: 'PRIVATE_TOKEN_REFERENCE',
      grants: {},
    },
  ],
  roleSync: {
    enabled: false,
    url: 'https://website.invalid/api/integrations/discord/role-sync',
    keyId: 'private-key-reference',
    secretEnv: 'PRIVATE_ROLE_SECRET',
    reconcileSeconds: 60,
  },
};
const initial: ManagementSettingsSnapshot = {
  revision: '0',
  settings: { defaultLocale: 'cs', serverLabels: { primary: 'Original' } },
};
let effective: ManagementSettingsSnapshot | null = structuredClone(initial);
let member: Membership;
let failApply = false;
let delayMember = false;
let reads = 0;
let revokeOnRead = Infinity;
let runtimeStale = false;
let leaseLost = false;
let server: Server;
let origin: string;
let directory: string;
const applied: ManagementSettingsSnapshot[] = [];
const store = new PostgresManagementStore(pool, botConfig);
const config = {
  keys: {
    website: { secret, scopes: ['bot.read', 'bot.configure'] as ('bot.read' | 'bot.configure')[] },
    readonly: { secret: secret + 'read', scopes: ['bot.read'] as ('bot.read' | 'bot.configure')[] },
  },
  grants: { 'bot.read': [role], 'bot.configure': [role] },
};
const getRuntime = (): ManagementRuntime => ({
  build: { version: '0.1.0', revision: 'a'.repeat(40) },
  startedAt: new Date().toISOString(),
  observedAt: new Date(Date.now() - (runtimeStale ? 31_000 : 0)).toISOString(),
  discord: 'connected',
  database: 'available',
  lease: leaseLost ? 'lost' : 'held',
  effective,
});
const members = {
  fetch: async () => {
    reads++;
    if (delayMember) await new Promise((done) => setTimeout(done, 2400));
    if (reads >= revokeOnRead) return { ...member, roleIds: [] };
    return structuredClone(member);
  },
};
const create = () =>
  createManagementServer({
    pool,
    botConfig,
    members,
    config,
    getRuntime,
    requestTimeoutMs: 2000,
    rateLimitPerMinute: 600,
    applySettings: (snapshot) => {
      if (failApply) throw new Error('PRIVATE_CALLBACK_DETAIL');
      applied.push(snapshot);
      effective = structuredClone(snapshot);
    },
  });
async function open() {
  server = create();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close() {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
function envelope(method: 'GET' | 'PATCH', path: string, data?: unknown, overrides = {}) {
  return signManagementRequest({
    method,
    path,
    body: data === undefined ? '' : JSON.stringify(data),
    actor: { guildId, userId },
    keyId: 'website',
    secret,
    ...overrides,
  });
}
const settingsPath = '/api/management/v1/settings';
const patch = (revision = '0') => ({
  expectedRevision: revision,
  settings: { defaultLocale: 'en', serverLabels: { primary: 'New label' } },
  reason: 'Update presentation',
  correlationId: randomUUID(),
});
async function send(
  method: 'GET' | 'PATCH',
  path: string,
  data?: unknown,
  signed = envelope(method, path, data),
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: signed.headers,
    ...(method === 'PATCH' ? { body: signed.body } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('real PostgreSQL management API and settings', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    directory = await mkdtemp(join(tmpdir(), 'valkyria-management-migrations-'));
    await copyFile('migrations/001_initial.sql', join(directory, '001_initial.sql'));
    await migrate(pool, directory);
    await pool.query(
      'INSERT INTO memberships(guild_id,user_id,role_ids,membership_state,observed_at) VALUES($1,$2,$3,$4,now())',
      [guildId, userId, '[]', 'present'],
    );
    await copyFile('migrations/002_management.sql', join(directory, '002_management.sql'));
    await migrate(pool, directory);
    expect((await pool.query('SELECT user_id FROM memberships')).rows).toEqual([
      { user_id: userId },
    ]);
    await migrate(pool, directory);
    await open();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE management_settings,management_replay,management_audit,role_outbox');
    await store.initialize();
    effective = structuredClone(initial);
    failApply = false;
    delayMember = false;
    reads = 0;
    revokeOnRead = Infinity;
    runtimeStale = false;
    leaseLost = false;
    botConfig.roleSync.enabled = false;
    applied.length = 0;
    member = {
      guildId,
      userId,
      roleIds: [role],
      state: 'present',
      observedAt: new Date().toISOString(),
    };
  });
  afterAll(async () => {
    if (server) await close();
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
    if (
      directory &&
      resolve(directory).startsWith(join(resolve(tmpdir()), 'valkyria-management-migrations-'))
    )
      await rm(directory, { recursive: true, force: true });
  });
  it('authenticates real HTTP reads and never returns private config or role payloads', async () => {
    const status = await send('GET', '/api/management/v1/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      schemaVersion: 1,
      roleSync: { state: 'disabled', pending: 0, failed: 0 },
      runtime: { discord: 'connected', lease: 'held' },
    });
    const settings = await send('GET', settingsPath);
    expect(settings.body).toMatchObject({
      desired: initial,
      effective: initial,
      applyState: 'applied',
    });
    for (const privateValue of [
      'PRIVATE_',
      'private-provider',
      'private-key-reference',
      'roleIds',
      secret,
    ])
      expect(JSON.stringify([settings.body, status.body])).not.toContain(privateValue);
    expect((await fetch(`${origin}${settingsPath}`)).status).toBe(401);
  });
  it('commits desired settings and audit before invoking the real runtime apply callback', async () => {
    const result = await send('PATCH', settingsPath, patch());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      desired: { revision: '1' },
      effective: { revision: '1' },
      applyState: 'applied',
    });
    expect(applied).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT code,reason,previous_revision::text,desired_revision::text FROM management_audit WHERE code='MANAGEMENT_SETTINGS_UPDATED'",
        )
      ).rows,
    ).toEqual([
      {
        code: 'MANAGEMENT_SETTINGS_UPDATED',
        reason: 'Update presentation',
        previous_revision: '0',
        desired_revision: '1',
      },
    ]);
    expect((await store.readSettings()).revision).toBe('1');
  });
  it('reports durable role delivery acknowledgement without treating an empty queue as successful sync', async () => {
    botConfig.roleSync.enabled = true;
    const roleStore = new PostgresStore(pool, guildId);
    const statusPath = '/api/management/v1/status';
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      enabled: true,
      state: 'unknown',
      pending: 0,
      failed: 0,
      lastDeliveredAt: null,
    });
    const event = await roleStore.saveMembership(member);
    const item = (await roleStore.claimOutbox(new Date(), 1))[0]!;
    await roleStore.completeOutbox(event.eventId, randomUUID());
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      state: 'unknown',
      pending: 1,
      failed: 0,
      lastDeliveredAt: null,
    });
    await roleStore.completeOutbox(event.eventId, item.leaseId);
    const expectedTime = (
      await pool.query<{ updated_at: Date }>(
        "SELECT updated_at FROM role_outbox WHERE event_id=$1 AND status='delivered'",
        [event.eventId],
      )
    ).rows[0]!.updated_at.toISOString();
    const delivered = (await send('GET', statusPath)).body.roleSync;
    expect(delivered).toMatchObject({
      state: 'healthy',
      pending: 0,
      failed: 0,
      lastDeliveredAt: expectedTime,
      oldestPendingAt: null,
    });
    for (const privateValue of [userId, role, event.eventId, 'roleIds', 'membershipState'])
      expect(JSON.stringify(delivered)).not.toContain(privateValue);
    await close();
    await open();
    await new PostgresStore(pool, guildId).completeOutbox(event.eventId, item.leaseId);
    expect((await send('GET', statusPath)).body.roleSync).toEqual(delivered);
  });
  it('distinguishes stale, delayed, failed and disabled role delivery and excludes other guilds', async () => {
    botConfig.roleSync.enabled = true;
    const roleStore = new PostgresStore(pool, guildId);
    const statusPath = '/api/management/v1/status';
    const foreignGuild = '555555555555555555';
    const foreign = new PostgresStore(pool, foreignGuild);
    await foreign.saveMembership({ ...member, guildId: foreignGuild });
    const foreignItem = (await foreign.claimOutbox(new Date(), 1))[0]!;
    await foreign.completeOutbox(foreignItem.event.eventId, foreignItem.leaseId);
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      state: 'unknown',
      pending: 0,
      failed: 0,
      lastDeliveredAt: null,
    });
    const first = await roleStore.saveMembership(member);
    const delivered = (await roleStore.claimOutbox(new Date(), 1))[0]!;
    await roleStore.completeOutbox(first.eventId, delivered.leaseId);
    await pool.query(
      "UPDATE role_outbox SET updated_at=clock_timestamp()-interval '6 minutes' WHERE event_id=$1",
      [first.eventId],
    );
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      state: 'stale',
      pending: 0,
      failed: 0,
    });
    const waiting = await roleStore.saveMembership(member);
    await pool.query(
      "UPDATE role_outbox SET created_at=clock_timestamp()-interval '61 seconds' WHERE event_id=$1",
      [waiting.eventId],
    );
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      state: 'degraded',
      pending: 1,
      failed: 0,
    });
    const failed = (await roleStore.claimOutbox(new Date(), 1))[0]!;
    await roleStore.failOutbox(waiting.eventId, failed.leaseId, 'ROLE_SYNC_REJECTED');
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      state: 'degraded',
      pending: 0,
      failed: 1,
    });
    botConfig.roleSync.enabled = false;
    expect((await send('GET', statusPath)).body.roleSync).toMatchObject({
      enabled: false,
      state: 'disabled',
      pending: 0,
      failed: 1,
    });
  });
  it('persists one-use nonces across concurrent delivery and a recreated HTTP server', async () => {
    const data = patch(),
      signed = envelope('PATCH', settingsPath, data);
    const results = await Promise.all([
      send('PATCH', settingsPath, data, signed),
      send('PATCH', settingsPath, data, signed),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(applied).toHaveLength(1);
    await close();
    await open();
    expect((await send('PATCH', settingsPath, data, signed)).status).toBe(409);
    const restored = new PostgresManagementStore(pool, botConfig);
    await restored.initialize();
    expect((await restored.readSettings()).settings.defaultLocale).toBe('en');
  });
  it('rejects concurrent distinct updates based on the same revision', async () => {
    const results = await Promise.all([
      send('PATCH', settingsPath, patch()),
      send('PATCH', settingsPath, patch()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(applied).toHaveLength(1);
    expect((await store.readSettings()).revision).toBe('1');
  });
  it('serializes real row-lock contenders across independent store instances', async () => {
    const identity = {
      actor: { guildId, userId },
      keyId: 'website',
      scope: 'bot.configure' as const,
      nonce: 'b'.repeat(32),
      method: 'PATCH',
      path: settingsPath,
      bodyDigest: '0'.repeat(64),
      expiresAt: Date.now() + 60_000,
    };
    const other = new PostgresManagementStore(pool, botConfig);
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let locked!: () => void;
    const hasLock = new Promise<void>((done) => {
      locked = done;
    });
    const a = store.update(identity, patch() as Parameters<typeof store.update>[1], async () => {
      locked();
      await gate;
    });
    await hasLock;
    const b = other.update(
      identity,
      patch() as Parameters<typeof store.update>[1],
      async () => undefined,
    );
    release();
    const outcomes = await Promise.allSettled([a, b]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await store.readSettings()).revision).toBe('1');
  });
  it('fails closed for stale, departed, wrong-user and revoked Discord membership', async () => {
    for (const change of [
      { observedAt: new Date(Date.now() - 61_000).toISOString() },
      { state: 'left' as const },
      { userId: '999999999999999999' },
      { roleIds: [] },
    ]) {
      const original = member;
      member = { ...member, ...change };
      expect((await send('PATCH', settingsPath, patch())).status).toBe(403);
      member = original;
    }
    expect(applied).toHaveLength(0);
    expect((await store.readSettings()).revision).toBe('0');
  });
  it('rechecks membership after acquiring the settings lock and denies a just-revoked actor', async () => {
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT guild_id FROM management_settings WHERE guild_id=$1 FOR UPDATE', [
      guildId,
    ]);
    const pending = send('PATCH', settingsPath, patch());
    try {
      while (reads === 0) await new Promise((done) => setTimeout(done, 1));
      member.roleIds = [];
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(applied).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });
  it('rolls back the settings transaction if its audit insert fails', async () => {
    await pool.query(
      "CREATE FUNCTION reject_management_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='MANAGEMENT_SETTINGS_UPDATED' THEN RAISE EXCEPTION 'PRIVATE_DB_DETAIL'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER reject_management_update BEFORE INSERT ON management_audit FOR EACH ROW EXECUTE FUNCTION reject_management_update()',
    );
    try {
      const result = await send('PATCH', settingsPath, patch());
      expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toContain('PRIVATE_DB_DETAIL');
      expect((await store.readSettings()).revision).toBe('0');
      expect(applied).toHaveLength(0);
    } finally {
      await pool.query('DROP TRIGGER reject_management_update ON management_audit');
      await pool.query('DROP FUNCTION reject_management_update()');
    }
  });
  it('reports desired versus effective error without claiming a failed callback applied settings', async () => {
    failApply = true;
    const result = await send('PATCH', settingsPath, patch());
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      desired: { revision: '1' },
      effective: { revision: '0' },
      applyState: 'error',
    });
    expect(JSON.stringify(result.body)).not.toContain('PRIVATE_CALLBACK_DETAIL');
    expect((await send('GET', settingsPath)).body.applyState).toBe('error');
  });
  it('rolls back a desired change if the request expires while its audit insert is blocked', async () => {
    await pool.query(
      "CREATE FUNCTION delay_management_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='MANAGEMENT_SETTINGS_UPDATED' THEN PERFORM pg_sleep(0.25); END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER delay_management_update BEFORE INSERT ON management_audit FOR EACH ROW EXECUTE FUNCTION delay_management_update()',
    );
    const limited = createManagementServer({
      pool,
      botConfig,
      members,
      config,
      getRuntime,
      requestTimeoutMs: 100,
      applySettings: (snapshot) => {
        applied.push(snapshot);
      },
    });
    await new Promise<void>((done) => limited.listen(0, '127.0.0.1', done));
    try {
      const signed = envelope('PATCH', settingsPath, patch());
      const response = await fetch(
        `http://127.0.0.1:${(limited.address() as { port: number }).port}${settingsPath}`,
        {
          method: 'PATCH',
          headers: signed.headers,
          body: signed.body,
        },
      );
      expect(response.status).toBe(504);
      await closeManagementServer(limited, 1000);
      expect((await store.readSettings()).revision).toBe('0');
      expect(applied).toHaveLength(0);
      expect(
        (
          await pool.query(
            "SELECT id FROM management_audit WHERE code='MANAGEMENT_SETTINGS_UPDATED'",
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await closeManagementServer(limited, 1000);
      await pool.query('DROP TRIGGER delay_management_update ON management_audit');
      await pool.query('DROP FUNCTION delay_management_update()');
    }
  });
  it('rejects authority/transport/process fields and unknown server IDs rather than widening scope', async () => {
    for (const data of [
      { ...patch(), grants: {} },
      { ...patch(), settings: { ...patch().settings, enabled: true } },
      { ...patch(), settings: { defaultLocale: 'en', serverLabels: { other: 'Unconfigured' } } },
    ])
      expect((await send('PATCH', settingsPath, data)).status).toBe(400);
    const data = patch();
    expect(
      (
        await send(
          'PATCH',
          settingsPath,
          data,
          envelope('PATCH', settingsPath, data, { keyId: 'readonly', secret: secret + 'read' }),
        )
      ).status,
    ).toBe(403);
    expect(applied).toHaveLength(0);
  });
  it('rejects stale runtime/lease loss and bounds membership outages without applying late results', async () => {
    runtimeStale = true;
    expect((await send('PATCH', settingsPath, patch())).status).toBe(503);
    runtimeStale = false;
    leaseLost = true;
    expect((await send('PATCH', settingsPath, patch())).status).toBe(503);
    leaseLost = false;
    delayMember = true;
    expect((await send('PATCH', settingsPath, patch())).status).toBe(504);
    await new Promise((done) => setTimeout(done, 500));
    expect((await store.readSettings()).revision).toBe('0');
    expect(applied).toHaveLength(0);
  });
  it('bounds HTTP input and rate limits before any fresh-member or settings work', async () => {
    const huge = await fetch(`${origin}${settingsPath}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(16_385),
    });
    expect(huge.status).toBe(413);
    const limited = createManagementServer({
      pool,
      botConfig,
      members,
      config,
      getRuntime,
      applySettings: () => undefined,
      rateLimitPerMinute: 1,
    });
    await new Promise<void>((done) => limited.listen(0, '127.0.0.1', done));
    const local = `http://127.0.0.1:${(limited.address() as { port: number }).port}`;
    try {
      expect((await fetch(`${local}${settingsPath}`)).status).toBe(401);
      const denied = await fetch(`${local}${settingsPath}`);
      expect(denied.status).toBe(429);
      expect(denied.headers.get('Retry-After')).toBe('60');
      expect(reads).toBe(0);
      expect(applied).toHaveLength(0);
    } finally {
      limited.closeAllConnections();
      await new Promise<void>((done) => limited.close(() => done()));
    }
  });
  it('shows stale observations and pending actual runtime application without claiming healthy/applied', async () => {
    runtimeStale = true;
    expect((await send('GET', '/api/management/v1/status')).body.runtime).toMatchObject({
      state: 'stale',
    });
    runtimeStale = false;
    const identity = {
      actor: { guildId, userId },
      keyId: 'website',
      scope: 'bot.configure' as const,
      nonce: 'c'.repeat(32),
      method: 'PATCH',
      path: settingsPath,
      bodyDigest: '0'.repeat(64),
      expiresAt: Date.now() + 60_000,
    };
    await store.update(
      identity,
      patch() as Parameters<typeof store.update>[1],
      async () => undefined,
    );
    expect((await send('GET', settingsPath)).body).toMatchObject({
      desired: { revision: '1' },
      effective: { revision: '0' },
      applyState: 'pending',
    });
  });
  it('shutdown fences pending membership and drains handlers before a late result can apply', async () => {
    delayMember = true;
    const pending = send('PATCH', settingsPath, patch()).catch(() => null);
    while (reads === 0) await new Promise((done) => setTimeout(done, 1));
    await closeManagementServer(server, 3000);
    await pending;
    await new Promise((done) => setTimeout(done, 2500));
    expect(applied).toHaveLength(0);
    expect((await store.readSettings()).revision).toBe('0');
    await closeManagementServer(server, 3000);
    await open();
  });
});
