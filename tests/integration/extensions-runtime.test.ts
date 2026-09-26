import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { Client } from 'discord.js';
import { expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/config.js';
import example from '../../config/bot.example.json' with { type: 'json' };
import { parseExtensionsConfig, resolveExtensionSecrets } from '../../src/extensions-config.js';
import { ExtensionsRuntime } from '../../src/extensions-runtime.js';
import { signManagementRequest } from '../../src/management/signing.js';
import { migrate } from '../../src/persistence/migrations.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must name a disposable database');

it('wires persisted desired settings to the actual runtime configuration and stops its private listener', async () => {
  const schema = `runtime_${randomUUID().replaceAll('-', '')}`;
  const initialMigrations = await mkdtemp(join(tmpdir(), 'valkyria-extensions-upgrade-'));
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
    statement_timeout: 3000,
  });
  const client = new Client({ intents: [] });
  // Only Gateway readiness is synthetic; HTTP, settings application and PostgreSQL are real.
  vi.spyOn(client, 'isReady').mockReturnValue(true);
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const secret = 'runtime-fixture-control-000000000000000000';
  const userId = '888888888888888888',
    role = '333333333333333333';
  const config = parseConfig(example);
  const cfg = parseExtensionsConfig(
    {
      management: {
        enabled: true,
        port,
        keys: { control: { secretEnv: 'CONTROL_SECRET', scopes: ['bot.read', 'bot.configure'] } },
        grants: { 'bot.read': [role], 'bot.configure': [role] },
      },
    },
    config,
  );
  const make = (bot = config) =>
    new ExtensionsRuntime({
      config: bot,
      extensions: cfg,
      secrets: resolveExtensionSecrets(cfg, bot, { CONTROL_SECRET: secret }),
      pool,
      client,
      members: {
        fetch: async () => ({
          guildId: bot.guildId,
          userId,
          roleIds: [role],
          state: 'present',
          observedAt: new Date().toISOString(),
        }),
      },
      games: new Map(),
      available: () => true,
      log: () => {},
    });
  let runtime = make();
  const url = `http://127.0.0.1:${port}`;
  async function send(method: 'GET' | 'PATCH', path: string, body = '') {
    const signed = signManagementRequest({
      method,
      path,
      body,
      actor: { guildId: config.guildId, userId },
      keyId: 'control',
      secret,
    });
    return fetch(url + path, { method, headers: signed.headers, ...(body ? { body } : {}) });
  }
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await copyFile('migrations/001_initial.sql', join(initialMigrations, '001_initial.sql'));
    await migrate(pool, initialMigrations);
    await pool.query(
      "INSERT INTO memberships(guild_id,user_id,role_ids,membership_state,observed_at) VALUES($1,$2,'[]','present',now())",
      [config.guildId, userId],
    );
    await migrate(pool);
    expect((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n).toBe(
      4,
    );
    expect((await pool.query('SELECT user_id FROM memberships')).rows[0].user_id).toBe(userId);
    await runtime.initialize();
    await expect
      .poll(async () => {
        const response = await send('GET', '/api/management/v1/status');
        const body = (await response.json()) as { runtime: { database: string } };
        return body.runtime.database;
      })
      .toBe('available');
    const settings = { defaultLocale: 'en', serverLabels: { primary: 'Runtime changed label' } };
    const patched = await send(
      'PATCH',
      '/api/management/v1/settings',
      JSON.stringify({
        expectedRevision: '0',
        settings,
        reason: 'Fixture applies real runtime settings',
        correlationId: randomUUID(),
      }),
    );
    expect(patched.status).toBe(200);
    expect(config.defaultLocale).toBe('en');
    expect(config.servers[0]!.label).toBe('Runtime changed label');
    await runtime.stop();
    await expect(fetch(url + '/api/management/v1/status')).rejects.toThrow();
    const restarted = parseConfig(example);
    runtime = make(restarted);
    await runtime.initialize();
    expect(restarted.defaultLocale).toBe('en');
    expect(restarted.servers[0]!.label).toBe('Runtime changed label');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM management_audit WHERE capability='bot.configure'",
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await runtime.stop();
    await client.destroy();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
    if (
      resolve(initialMigrations).startsWith(join(resolve(tmpdir()), 'valkyria-extensions-upgrade-'))
    )
      await rm(initialMigrations, { recursive: true, force: true });
  }
});
