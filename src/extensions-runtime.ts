import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import type { Pool } from 'pg';
import type { BotConfig, GameServer, MembershipProvider } from './contracts.js';
import type { InteractionPort } from './discord/handler.js';
import type { ExtensionsConfig, resolveExtensionSecrets } from './extensions-config.js';
import { EffectiveSettings, PeriodicTasks } from './integration/lifecycle.js';
import { listenUntilAborted } from './integration/listener.js';
import { PublicationIngress } from './integration/publication-ingress.js';
import { PostgresPublicationCursor } from './integration/cursor-store.js';
import {
  createManagementServer,
  closeManagementServer,
  PostgresManagementStore,
  type ManagementRuntime,
} from './management/index.js';
import { parsePublicationEvent, type PublicationDestination } from './publications/contracts.js';
import { PostgresPublicationStore } from './publications/store.js';
import { PublicationService } from './publications/service.js';
import { StatusBoardPoller } from './publications/status.js';
import {
  DiscordPublicationTransport,
  PublicationTransportError,
} from './publications/transport.js';
import { handleSignup } from './signup/handler.js';
import { WebsiteClient } from './website/client.js';

interface Options {
  config: BotConfig;
  extensions: ExtensionsConfig;
  secrets: ReturnType<typeof resolveExtensionSecrets>;
  pool: Pool;
  client: Client;
  members: MembershipProvider;
  games: ReadonlyMap<string, GameServer>;
  available: () => boolean;
  log: (event: string) => void;
}

/** Owned by the process holding the existing guild runtime lease. */
export class ExtensionsRuntime {
  private readonly tasks: PeriodicTasks;
  private readonly effective: EffectiveSettings;
  private server: Server | null = null;
  private readonly abort = new AbortController();
  private stopped = false;
  private started = false;
  private initialized = false;
  private readonly startedAt = new Date().toISOString();
  private observedAt = this.startedAt;
  private database: ManagementRuntime['database'] = 'unknown';
  private build = { version: 'unknown', revision: 'unknown' };
  private website: WebsiteClient | null = null;
  private publications: PublicationService | null = null;
  private ingress: PublicationIngress | null = null;
  private boards: StatusBoardPoller | null = null;
  constructor(private readonly options: Options) {
    this.tasks = new PeriodicTasks(() => options.log('extension_operation_unavailable'));
    this.effective = new EffectiveSettings(options.config);
  }
  async initialize() {
    const o = this.options,
      cfg = o.extensions;
    if (this.stopped) return;
    if (cfg.management.enabled) {
      const metadata: unknown = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8'),
      );
      const version = (metadata as { version?: unknown }).version;
      this.build = {
        version:
          typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)
            ? version
            : 'unknown',
        revision: /^[a-f0-9]{40}$/.test(process.env.BUILD_REVISION ?? '')
          ? process.env.BUILD_REVISION!
          : 'unknown',
      };
      const settings = new PostgresManagementStore(o.pool, o.config);
      await settings.initialize();
      this.effective.apply(await settings.readSettings());
      if (this.stopped) return;
      this.server = createManagementServer({
        pool: o.pool,
        botConfig: o.config,
        members: o.members,
        config: { keys: o.secrets.management, grants: cfg.management.grants },
        getRuntime: () => ({
          build: this.build,
          startedAt: this.startedAt,
          observedAt: this.observedAt,
          database: this.database,
          discord: o.client.isReady() ? 'connected' : 'disconnected',
          lease: !this.stopped && o.available() ? 'held' : 'unknown',
          effective: this.effective.get(),
        }),
        applySettings: (snapshot) => {
          if (this.stopped || !o.available()) throw new Error('runtime_unavailable');
          this.effective.apply(snapshot);
        },
      });
      if (!(await listenUntilAborted(this.server, cfg.management, this.abort.signal))) return;
      this.tasks.start(async () => {
        try {
          await o.pool.query('SELECT 1');
          this.database = 'available';
        } catch {
          this.database = 'unavailable';
        }
        this.observedAt = new Date().toISOString();
      }, 5000);
    }
    if (this.stopped) return;
    if (o.secrets.website)
      this.website = new WebsiteClient({ origin: o.config.websiteUrl, keys: o.secrets.website });
    if (cfg.publications.enabled) {
      if (!this.website) throw new Error('invalid_extensions_configuration');
      const store = new PostgresPublicationStore(o.pool, o.config.guildId);
      this.publications = new PublicationService({
        store,
        transport: new DiscordPublicationTransport({
          post: (route, options) => {
            if (!this.dispatchAvailable()) throw new PublicationTransportError('forbidden');
            return o.client.rest.post(route, options);
          },
          patch: (route, options) => {
            if (!this.dispatchAvailable()) throw new PublicationTransportError('forbidden');
            return o.client.rest.patch(route, options);
          },
        }),
        source: this.website,
        destinations: [
          ...new Map(
            [
              ...cfg.publications.destinations,
              ...cfg.publications.boards.map((b) => b.destination),
            ].map((d) => [`${d.guildId}:${d.channelId}:${d.locale}:${d.purpose}`, d]),
          ).values(),
        ],
        enabled: true,
        signupEnabled: cfg.signup.enabled,
        websiteOrigin: o.config.websiteUrl,
        authorizeDestination: (destination) => this.authorizeDestination(destination),
      });
      await this.publications.recover();
      if (this.stopped) return;
      this.ingress = cfg.publications.destinations.length
        ? new PublicationIngress({
            enabled: true,
            source: this.website,
            consumer: {
              accept: (event) => this.publications!.accept(parsePublicationEvent(event)),
            },
            store: new PostgresPublicationCursor(o.pool, o.config.guildId),
          })
        : null;
      this.boards = new StatusBoardPoller({
        store,
        boards: cfg.publications.boards,
        enabled: true,
        readStatus: async (serverId) => {
          const game = o.games.get(serverId);
          if (!game) throw new Error('server_unavailable');
          return game.status();
        },
      });
    }
    this.initialized = true;
  }
  start() {
    if (this.stopped || this.started || !this.initialized) return;
    this.started = true;
    const run = (work: () => Promise<unknown>, interval: number) =>
      this.tasks.start(async () => {
        if (this.options.available() && this.options.client.isReady()) await work();
      }, interval);
    if (this.ingress)
      run(() => this.ingress!.tick(), this.options.extensions.publications.pollSeconds * 1000);
    if (this.publications) run(() => this.publications!.tick(), 1000);
    if (this.boards) run(() => this.boards!.tick(), 1000);
  }
  handles(port: InteractionPort) {
    return (
      this.options.extensions.signup.enabled &&
      port.input.kind === 'button' &&
      port.input.customId.startsWith('vlk:signup:')
    );
  }
  async signup(port: InteractionPort) {
    if (this.stopped || !this.options.available() || !this.website || !this.handles(port)) return;
    await handleSignup(port, {
      guildId: this.options.config.guildId,
      defaultLocale: this.options.config.defaultLocale,
      websiteOrigin: this.options.config.websiteUrl,
      membership: this.options.members,
      website: this.website,
    });
  }
  private async authorizeDestination(destination: PublicationDestination) {
    if (!this.dispatchAvailable()) return false;
    const channel = await this.options.client.channels.fetch(destination.channelId, {
      force: true,
    });
    if (
      !channel ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
      !('guild' in channel) ||
      channel.guild.id !== this.options.config.guildId ||
      channel.guild.id !== destination.guildId
    )
      return false;
    // Refresh roles and bot member before evaluating the newly fetched channel overwrites.
    await channel.guild.roles.fetch();
    const me = await channel.guild.members.fetchMe({ force: true });
    const permissions = 'permissionsFor' in channel ? channel.permissionsFor(me) : null;
    return (
      this.dispatchAvailable() &&
      Boolean(
        permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ]),
      )
    );
  }
  private dispatchAvailable() {
    return !this.stopped && this.options.available() && this.options.client.isReady();
  }
  async stop() {
    this.stopped = true;
    this.abort.abort();
    const close = this.server ? closeManagementServer(this.server) : Promise.resolve();
    await Promise.all([close, this.tasks.stop()]);
  }
}
