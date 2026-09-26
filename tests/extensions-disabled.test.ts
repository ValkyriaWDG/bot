import { Client } from 'discord.js';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.js';
import example from '../config/bot.example.json' with { type: 'json' };
import extensionsExample from '../config/extensions.example.json' with { type: 'json' };
import { parseExtensionsConfig, resolveExtensionSecrets } from '../src/extensions-config.js';
import { ExtensionsRuntime } from '../src/extensions-runtime.js';

it('the supplied disabled configuration starts and stops without any extension dependency IO', async () => {
  const config = parseConfig(example);
  const extensions = parseExtensionsConfig(extensionsExample, config);
  const pool = new Pool({ connectionString: 'postgresql://fixture@127.0.0.1:1/never_connect' });
  const client = new Client({ intents: [] });
  const query = vi.spyOn(pool, 'query').mockImplementation(() => {
    throw new Error('unexpected_database_io');
  });
  const connect = vi.spyOn(pool, 'connect').mockImplementation(() => {
    throw new Error('unexpected_database_connect');
  });
  const membership = vi.fn(async () => {
    throw new Error('unexpected_discord_io');
  });
  const runtime = new ExtensionsRuntime({
    config,
    extensions,
    secrets: resolveExtensionSecrets(extensions, config, {}),
    pool,
    client,
    members: { fetch: membership },
    games: new Map(),
    available: () => true,
    log: () => {},
  });
  try {
    await runtime.initialize();
    runtime.start();
    await new Promise<void>((done) => setImmediate(done));
    await runtime.stop();
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(membership).not.toHaveBeenCalled();
  } finally {
    await runtime.stop();
    await client.destroy();
    await pool.end();
  }
});
