import { Client, Events, GatewayIntentBits } from 'discord.js';
import { Pool } from 'pg';
import { readConfig, healthOptions } from './runtime-config.js';
import { requiredSecret } from './config.js';
import { BotError } from './errors.js';
import { DiscordMembershipProvider } from './discord/membership.js';
import { handleInteraction } from './discord/handler.js';
import { portFor } from './discord/port.js';
import { createHealthServer } from './health.js';
import { OperationsService } from './operations.js';
import { PostgresStore } from './persistence/store.js';
import { RoleSyncService } from './rolesync/service.js';
import { WardogsClient } from './wardogs/client.js';
import { readExtensionsConfig, resolveExtensionSecrets } from './extensions-config.js';
import { ExtensionsRuntime } from './extensions-runtime.js';
import { listenUntilAborted } from './integration/listener.js';

const log = (event: string) =>
  console.log(JSON.stringify({ event, time: new Date().toISOString() }));

async function main() {
  const offline = process.argv.slice(2).includes('--offline');
  if (process.argv.slice(2).some((arg) => arg !== '--offline'))
    throw new BotError('invalid_configuration');
  const health = healthOptions();
  if (offline) {
    const server = createHealthServer(async () => false, 'offline');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(health.port, health.host, resolve);
    });
    log('offline_health_ready');
    const close = () => {
      server.close(() => {
        process.exitCode = 0;
      });
      server.closeAllConnections();
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    return;
  }
  const config = await readConfig();
  const extensionsConfig = await readExtensionsConfig(config);
  const extensionSecrets = resolveExtensionSecrets(extensionsConfig, config, process.env);
  const writeValue = process.env.WARDOGS_WRITES_ENABLED ?? 'false';
  if (!['true', 'false'].includes(writeValue)) throw new BotError('invalid_configuration');
  const token = requiredSecret(process.env, 'DISCORD_BOT_TOKEN');
  const games = new Map(
    config.servers.map((server) => [
      server.id,
      new WardogsClient({
        baseUrl: server.baseUrl,
        token: requiredSecret(process.env, server.tokenEnv),
      }),
    ]),
  );
  const pool = new Pool({
    connectionString: requiredSecret(process.env, 'DATABASE_URL'),
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    application_name: 'valkyria-bot',
  });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      ...(config.roleSync.enabled ? [GatewayIntentBits.GuildMembers] : []),
    ],
    rest: { timeout: 5000, retries: 0, rejectOnRateLimit: () => true },
    allowedMentions: { parse: [] },
  });
  const members = new DiscordMembershipProvider(client.rest, config.guildId);
  const store = new PostgresStore(pool, config.guildId);
  const sync = config.roleSync.enabled
    ? new RoleSyncService(
        {
          guildId: config.guildId,
          url: config.roleSync.url,
          keyId: config.roleSync.keyId,
          secret: requiredSecret(process.env, config.roleSync.secretEnv, 32),
          enabled: true,
          reconcileSeconds: config.roleSync.reconcileSeconds,
        },
        store,
        members,
      )
    : null;
  const operations = new OperationsService(config, members, store, games, writeValue === 'true');
  let stopping = false;
  const abort = new AbortController();
  let ready = false;
  const extensions = new ExtensionsRuntime({
    config,
    extensions: extensionsConfig,
    secrets: extensionSecrets,
    pool,
    client,
    members,
    games,
    available: () => !stopping && ready,
    log,
  });
  const pending = new Set<Promise<unknown>>();
  const timers: ReturnType<typeof setInterval>[] = [];
  const track = (work: Promise<unknown>) => {
    pending.add(work);
    void work.catch(() => log('operation_unavailable')).finally(() => pending.delete(work));
  };
  const server = createHealthServer(async () => {
    if (stopping || !ready || !client.isReady()) return false;
    await pool.query('SELECT 1');
    return true;
  }, 'live');
  let releaseLease: (() => Promise<void>) | undefined;
  let finishStartup: () => void = () => {};
  const startupFinished = new Promise<void>((resolve) => {
    finishStartup = resolve;
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    abort.abort();
    ready = false;
    for (const timer of timers) clearInterval(timer);
    const deadline = setTimeout(() => {
      process.exit(1);
    }, 20_000);
    deadline.unref();
    shutdownPromise = (async () => {
      try {
        await extensions.stop();
        await client.destroy();
        server.close();
        server.closeAllConnections();
        // A lease acquired while shutdown was requested still belongs to this
        // process. Let startup reach its stopping guard before releasing it.
        await startupFinished;
        await Promise.allSettled([...pending]);
        try {
          await releaseLease?.();
        } finally {
          await pool.end();
        }
        log('shutdown_complete');
      } finally {
        clearTimeout(deadline);
      }
    })();
    return shutdownPromise;
  };
  const requestShutdown = () => {
    void shutdown().catch(() => {
      log('shutdown_failed');
      process.exit(1);
    });
  };
  pool.on('error', () => {
    log('database_unavailable');
    process.exitCode = 1;
    requestShutdown();
  });
  client.on(Events.Error, () => log('discord_unavailable'));
  process.once('SIGTERM', requestShutdown);
  process.once('SIGINT', requestShutdown);
  try {
    releaseLease = await store.acquireRuntimeLease(() => {
      // The database lock is already gone. Draining callbacks could dispatch after
      // a replacement runtime recovers their intents; stop the process immediately.
      log('runtime_lease_lost');
      process.exit(1);
    });
    if (stopping) return;
    await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    if (stopping) return;
    await store.recoverInterrupted();
    if (stopping) return;
    await extensions.initialize();
    if (stopping) return;
    if (!(await listenUntilAborted(server, health, abort.signal))) return;
    if (stopping) return;
    client.on(Events.InteractionCreate, (interaction) => {
      if (stopping) return;
      const port = portFor(interaction);
      if (!port) return;
      track(
        extensions.handles(port)
          ? extensions.signup(port)
          : handleInteraction(port, {
              config,
              operations,
              ...(sync
                ? {
                    onAccountRefresh: async (userId: string) => {
                      if (!(await sync.refresh(userId)))
                        throw new BotError('membership_unavailable');
                    },
                  }
                : {}),
            }),
      );
    });
    const refresh = (guildId: string, userId: string) => {
      if (guildId !== config.guildId || stopping) return;
      members.invalidate(userId);
      if (sync) track(sync.refresh(userId));
    };
    client.on(Events.GuildMemberAdd, (member) => refresh(member.guild.id, member.id));
    client.on(Events.GuildMemberUpdate, (_old, member) => refresh(member.guild.id, member.id));
    client.on(Events.GuildMemberRemove, (member) => {
      if (member.guild.id !== config.guildId || stopping) return;
      members.invalidate(member.id);
      if (sync) track(sync.depart(member.id));
    });
    client.once(Events.ClientReady, () => {
      if (stopping) return;
      if (!client.guilds.cache.has(config.guildId)) {
        log('configured_guild_unavailable');
        process.exitCode = 1;
        requestShutdown();
        return;
      }
      ready = true;
      extensions.start();
      log('discord_ready');
      if (sync) {
        track(sync.reconcile());
        timers.push(setInterval(() => track(sync.tick()), 1000));
        timers.push(
          setInterval(() => track(sync.reconcile()), config.roleSync.reconcileSeconds * 1000),
        );
      }
    });
    await client.login(token);
  } catch (error) {
    finishStartup();
    await shutdown();
    throw error;
  } finally {
    finishStartup();
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'startup_failed',
      code: error instanceof BotError ? error.code : 'dependency_unavailable',
    }),
  );
  process.exitCode = 1;
});
