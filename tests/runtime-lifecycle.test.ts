import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const fixture = `
  import { EventEmitter } from 'node:events';
  import net from 'node:net';
  import { Server } from 'node:http';
  import pg from 'pg';
  import { Client, Events } from 'discord.js';
  const events = [];
  const record = (event) => { events.push(event); console.log(JSON.stringify({ fixtureEvent: event })); };
  net.Socket.prototype.connect = function() { throw new Error('NETWORK_DISABLED_IN_TEST'); };
  process.argv = ['node', 'main'];
  Object.assign(process.env, {
    BOT_CONFIG_FILE: 'config/bot.example.json', DISCORD_BOT_TOKEN: 'fixture',
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture',
    WARDOGS_PRIMARY_TOKEN: 'fixture', WARDOGS_WRITES_ENABLED: 'false',
    HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '3000'
  });
  const dbClient = new EventEmitter();
  dbClient.query = async (sql) => {
    if (sql.includes('pg_try_advisory_lock')) record('lease_acquired');
    if (sql.includes('pg_advisory_unlock')) record('lease_released');
    return { rows: sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [], rowCount: 0 };
  };
  dbClient.release = () => {};
  pg.Pool.prototype.connect = async function() { return dbClient; };
  pg.Pool.prototype.query = async function() { record('schema_checked'); return { rows: [] }; };
  pg.Pool.prototype.end = async function() { record('pool_closed'); };
  Server.prototype.listen = function(...args) { record('health_listen'); queueMicrotask(args.at(-1)); return this; };
  Server.prototype.close = function(callback) { record('health_closed'); callback?.(); return this; };
  Server.prototype.closeAllConnections = function() {};
  const destroy = Client.prototype.destroy;
  Client.prototype.destroy = async function() { record('destroy_started'); return destroy.call(this); };
  Client.prototype.login = async function() { record('login'); return 'fixture'; };
`;

function run(script: string, timeout = 5_000) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `${fixture}\n${script}\nawait import('./src/main.ts');`,
    ],
    { encoding: 'utf8', timeout },
  );
  const records = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { fixtureEvent?: string; event?: string });
  return {
    ...result,
    events: records.flatMap((entry) => (entry.fixtureEvent ? [entry.fixtureEvent] : [])),
    logs: records.flatMap((entry) => (entry.event ? [entry.event] : [])),
  };
}

it('waits for a pending startup lease then releases it without continuing initialization after SIGTERM', () => {
  const result = run(`
    let first = true;
    pg.Pool.prototype.connect = async function() {
      if (first) {
        first = false;
        queueMicrotask(() => process.emit('SIGTERM'));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return dbClient;
    };
  `);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.events).not.toContain('schema_checked');
  expect(result.events).not.toContain('health_listen');
  expect(result.events).not.toContain('login');
  expect(result.events).toContain('lease_released');
  expect(result.events.indexOf('lease_released')).toBeLessThan(
    result.events.indexOf('pool_closed'),
  );
});

it('does not become ready after shutdown starts during Discord login', () => {
  const result = run(`
    Client.prototype.login = async function() {
      record('login');
      this.guilds.cache.set('111111111111111111', {});
      process.emit('SIGTERM');
      this.emit(Events.ClientReady, this);
      return 'fixture';
    };
  `);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.logs).not.toContain('discord_ready');
  expect(result.logs).toContain('shutdown_complete');
});

it('arms the shutdown deadline before waiting for a stalled Discord destroy', () => {
  const result = run(
    `
    const nativeTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 20_000 ? 30 : delay, ...args);
    Client.prototype.destroy = async function() { record('destroy_started'); return new Promise(() => {}); };
    Client.prototype.login = async function() { setInterval(() => {}, 1_000); process.emit('SIGTERM'); return 'fixture'; };
  `,
    8_000,
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.events).toContain('destroy_started');
  expect(result.logs).not.toContain('shutdown_complete');
}, 10_000);

it('exits immediately on runtime lease loss without draining or releasing a vanished lease', () => {
  const result = run(`
    Client.prototype.login = async function() {
      dbClient.emit('error', new Error('PRIVATE_DATABASE_DETAIL'));
      record('continued_after_lease_loss');
      return 'fixture';
    };
  `);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.logs).toContain('runtime_lease_lost');
  expect(result.events).not.toContain('continued_after_lease_loss');
  expect(result.events).not.toContain('destroy_started');
  expect(result.events).not.toContain('lease_released');
  expect(result.stdout + result.stderr).not.toContain('PRIVATE_DATABASE_DETAIL');
});
