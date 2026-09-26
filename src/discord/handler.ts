import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIActionRowComponent,
  type APIButtonComponent,
} from 'discord.js';
import type {
  Actor,
  BotConfig,
  Capability,
  Intent,
  Locale,
  Membership,
  Player,
  ServerAction,
  ServerStatus,
} from '../contracts.js';
import { BotError } from '../errors.js';

type BaseInput = { id: string; guildId: string | null; userId: string };
export type InteractionInput = BaseInput &
  (
    | {
        kind: 'command';
        commandName: string;
        subcommand?: string;
        options: Readonly<Record<string, string | undefined>>;
      }
    | { kind: 'button'; customId: string }
  );
export interface Response {
  content: string;
  components: APIActionRowComponent<APIButtonComponent>[];
  allowedMentions: { parse: [] };
}
export interface InteractionPort {
  input: InteractionInput;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(response: Response): Promise<unknown>;
  clearSourceComponents(): Promise<unknown>;
}
export interface OperationsPort {
  account(
    actor: Actor,
  ): Promise<{ member: Membership; capabilities: Record<string, Capability[]> }>;
  status(actor: Actor, serverId: string): Promise<ServerStatus>;
  players(actor: Actor, serverId: string): Promise<Player[]>;
  preview(
    actor: Actor,
    interactionId: string,
    serverId: string,
    action: ServerAction,
  ): Promise<Intent>;
  confirm(actor: Actor, id: string): Promise<'succeeded' | 'failed' | 'unknown'>;
  cancel(actor: Actor, id: string): Promise<boolean>;
}
export interface HandlerDependencies {
  operations: OperationsPort;
  config: BotConfig;
  // Resolve only after durable enqueue; reject failed/fenced observations when delivery is enabled.
  onAccountRefresh?: (userId: string) => Promise<void>;
}
const copy = (locale: Locale, cs: string, en: string) => (locale === 'cs' ? cs : en);
const buttonId =
  /^(confirm|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(cs|en)$/;

function safeText(value: string, limit = 160): string {
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bounded = cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
  return bounded.replace(/@/g, '@\u200b').replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, '\\$&');
}
function response(content: string, components: Response['components'] = []): Response {
  return {
    content: content.length > 2000 ? `${content.slice(0, 1999)}…` : content,
    components,
    allowedMentions: { parse: [] },
  };
}
function required(
  options: Readonly<Record<string, string | undefined>>,
  key: string,
  max: number,
): string {
  const value = options[key]?.trim();
  if (!value || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value))
    throw new BotError('invalid_input');
  return value;
}
function actionFor(input: Extract<InteractionInput, { kind: 'command' }>): ServerAction {
  const { options, subcommand } = input;
  if (subcommand === 'restart') return { type: 'restart' };
  if (subcommand === 'broadcast')
    return { type: 'broadcast', message: required(options, 'message', 200) };
  if (subcommand === 'map') return { type: 'map', map: required(options, 'map', 80) };
  if (subcommand === 'kick' || subcommand === 'ban' || subcommand === 'unban') {
    const steamId = required(options, 'steam_id', 17);
    if (!/^[0-9]{17}$/.test(steamId)) throw new BotError('invalid_input');
    return subcommand === 'unban'
      ? { type: subcommand, steamId }
      : { type: subcommand, steamId, reason: required(options, 'reason', 200) };
  }
  throw new BotError('invalid_input');
}
function actionSummary(action: ServerAction, locale: Locale): string {
  switch (action.type) {
    case 'broadcast':
      return copy(
        locale,
        `Zpráva všem hráčům: ${safeText(action.message, 200)}`,
        `Broadcast to all players: ${safeText(action.message, 200)}`,
      );
    case 'kick':
      return copy(
        locale,
        `Odpojit hráče ${action.steamId}. Důvod: ${safeText(action.reason, 200)}`,
        `Disconnect player ${action.steamId}. Reason: ${safeText(action.reason, 200)}`,
      );
    case 'ban':
      return copy(
        locale,
        `Zakázat přístup hráči ${action.steamId}. Důvod: ${safeText(action.reason, 200)}`,
        `Ban player ${action.steamId}. Reason: ${safeText(action.reason, 200)}`,
      );
    case 'unban':
      return copy(
        locale,
        `Zrušit zákaz hráče ${action.steamId}.`,
        `Remove the ban for player ${action.steamId}.`,
      );
    case 'map':
      return copy(
        locale,
        `Změnit mapu na ${safeText(action.map, 80)}. Přeruší aktuální hru.`,
        `Change the map to ${safeText(action.map, 80)}. Interrupts the current game.`,
      );
    case 'restart':
      return copy(
        locale,
        'Restartovat aktuální zápas. Přeruší aktuální hru; nejde o restart hostitele.',
        'Restart the current match. Interrupts the current game; does not restart the host.',
      );
  }
}
function safeError(error: unknown, locale: Locale): string {
  const code = error instanceof BotError ? error.code : 'unexpected';
  switch (code) {
    case 'wrong_guild':
      return copy(
        locale,
        'Příkaz lze použít pouze na určeném serveru Discord.',
        'This command is available only in the configured Discord server.',
      );
    case 'forbidden':
    case 'not_authorized':
      return copy(
        locale,
        'Pro tuto akci nemáte oprávnění.',
        'You do not have permission for this action.',
      );
    case 'invalid_input':
    case 'invalid_action':
    case 'unknown_server':
      return copy(
        locale,
        'Neplatný příkaz nebo vstup. Použijte /help a vyberte nakonfigurovaný server.',
        'Invalid command or input. Use /help and select a configured server.',
      );
    case 'invalid_confirmation':
    case 'intent_expired':
    case 'intent_unavailable':
    case 'intent_not_found':
    case 'intent_consumed':
      return copy(
        locale,
        'Potvrzení již není platné. Stav akce ověřte před vytvořením nové žádosti.',
        'This confirmation is no longer valid. Check the action state before creating a new request.',
      );
    case 'duplicate_interaction':
      return copy(
        locale,
        'Tento požadavek už byl přijat. Před další žádostí ověřte jeho stav.',
        'This request was already received. Check its state before creating another request.',
      );
    case 'control_disabled':
    case 'writes_disabled':
      return copy(
        locale,
        'Změny herního serveru jsou vypnuté.',
        'Game server changes are disabled.',
      );
    case 'membership_unavailable':
      return copy(
        locale,
        'Členství a oprávnění nyní nelze ověřit. Zásah nebude proveden.',
        'Membership and permissions cannot be verified now. The operation will not run.',
      );
    default:
      return copy(
        locale,
        'Požadavek se nepodařilo dokončit. Zkontrolujte stav před opakováním zásahu.',
        'The request could not be completed. Check the state before repeating an operation.',
      );
  }
}

async function routeCommand(
  input: Extract<InteractionInput, { kind: 'command' }>,
  actor: Actor,
  locale: Locale,
  deps: HandlerDependencies,
): Promise<Response> {
  const { operations, config } = deps;
  if (input.commandName === 'help' && input.subcommand === undefined) {
    return response(
      copy(locale, 'Nápověda Valkyria', 'Valkyria help') +
        '\n/help · /account\n/server status · /server players\n/admin broadcast · kick · ban · unban · map · restart\n' +
        copy(
          locale,
          'Správa vyžaduje přidělenou roli a jednorázové potvrzení.',
          'Administration requires an assigned role and one-use confirmation.',
        ) +
        `\n${config.websiteUrl}`,
    );
  }
  if (input.commandName === 'account' && input.subcommand === undefined) {
    const result = await operations.account(actor);
    let sync = copy(
      locale,
      'Synchronizace rolí s webem je vypnutá.',
      'Website role synchronization is disabled.',
    );
    if (config.roleSync.enabled)
      sync = copy(
        locale,
        'Synchronizace rolí s webem je nyní nedostupná.',
        'Website role synchronization is currently unavailable.',
      );
    if (deps.onAccountRefresh) {
      try {
        await deps.onAccountRefresh(actor.userId);
        if (config.roleSync.enabled)
          sync = copy(
            locale,
            'Synchronizace rolí čeká na zpracování; přihlášení na web tím není potvrzeno.',
            'Role synchronization is pending; this does not confirm a website login.',
          );
      } catch {
        /* Optional delivery cannot invalidate authoritative membership. */
      }
    }
    const grants = config.servers.flatMap((server) => {
      const capabilities = result.capabilities[server.id] ?? [];
      return capabilities.length
        ? [`${safeText(server.label, 80)}: ${capabilities.join(', ')}`]
        : [];
    });
    return response(
      [
        copy(locale, 'Účet a oprávnění', 'Account and permissions'),
        copy(locale, 'Členství ověřeno:', 'Membership checked:'),
        safeText(result.member.observedAt, 40),
        ...grants,
        grants.length
          ? ''
          : copy(locale, 'Žádná oprávnění ke správě serverů.', 'No game server permissions.'),
        sync,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (input.commandName !== 'server' && input.commandName !== 'admin')
    throw new BotError('invalid_input');
  const serverId = required(input.options, 'server', 100);
  const server = config.servers.find((entry) => entry.id === serverId);
  if (!server) throw new BotError('unknown_server');
  if (input.commandName === 'server' && input.subcommand === 'status') {
    const status = await operations.status(actor, serverId);
    return response(
      [
        copy(locale, 'Stav serveru', 'Server status'),
        safeText(status.serverName),
        `${copy(locale, 'Mapa', 'Map')}: ${safeText(status.map, 80)}`,
        `${copy(locale, 'Hráči', 'Players')}: ${status.playerCount}/${status.maxPlayers}`,
        `${copy(locale, 'Čas zápasu', 'Match time')}: ${status.matchSeconds === null ? copy(locale, 'není dostupný', 'unavailable') : `${status.matchSeconds} s`}`,
      ].join('\n'),
    );
  }
  if (input.commandName === 'server' && input.subcommand === 'players') {
    const players = await operations.players(actor, serverId);
    const shown = players.slice(0, 20);
    return response(
      [
        copy(
          locale,
          `Hráči — zobrazeno ${shown.length} z ${players.length}`,
          `Players — showing ${shown.length} of ${players.length}`,
        ),
        safeText(server.label, 80),
        ...shown.map((player, index) => `${index + 1}. ${safeText(player.name, 35)}`),
        players.length === 0
          ? copy(locale, 'Na serveru nejsou žádní hráči.', 'No players are on the server.')
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (input.commandName !== 'admin') throw new BotError('invalid_input');
  const intent = await operations.preview(actor, input.id, serverId, actionFor(input));
  const expiration = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiration) || !buttonId.test(`confirm:${intent.id}:${locale}`))
    throw new BotError('invalid_input');
  return response(
    [
      copy(locale, 'Potvrzení zásahu', 'Confirm operation'),
      `${copy(locale, 'Server', 'Server')}: ${safeText(server.label, 80)} (${safeText(serverId, 100)})`,
      actionSummary(intent.action, locale),
      `${copy(locale, 'Platnost do', 'Expires')}: <t:${Math.floor(expiration / 1000)}:F>`,
      copy(
        locale,
        'Provede se pouze po potvrzení a nové kontrole oprávnění.',
        'Runs only after confirmation and a new permission check.',
      ),
    ].join('\n'),
    [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Danger,
            label: copy(locale, 'Potvrdit zásah', 'Confirm operation'),
            custom_id: `confirm:${intent.id}:${locale}`,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: copy(locale, 'Zrušit', 'Cancel'),
            custom_id: `cancel:${intent.id}:${locale}`,
          },
        ],
      },
    ],
  );
}

export async function handleInteraction(
  interaction: InteractionPort,
  deps: HandlerDependencies,
): Promise<void> {
  const { input } = interaction;
  const parsedButton = input.kind === 'button' ? buttonId.exec(input.customId) : null;
  const selected = input.kind === 'command' ? input.options.language : parsedButton?.[3];
  const locale: Locale =
    selected === 'cs' || selected === 'en' ? selected : deps.config.defaultLocale;
  // No downstream IO or mutation may start unless Discord has acknowledged privately.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result: Response;
  try {
    if (input.guildId !== deps.config.guildId) throw new BotError('wrong_guild');
    if (selected !== undefined && selected !== 'cs' && selected !== 'en')
      throw new BotError('invalid_input');
    const actor = { guildId: input.guildId, userId: input.userId };
    if (input.kind === 'command') {
      result = await routeCommand(input, actor, locale, deps);
    } else {
      if (!parsedButton) throw new BotError('invalid_input');
      const id = parsedButton[2]!;
      if (parsedButton[1] === 'cancel') {
        if (!(await deps.operations.cancel(actor, id))) throw new BotError('intent_unavailable');
        result = response(copy(locale, 'Žádost byla zrušena.', 'The request was cancelled.'));
      } else {
        const outcome = await deps.operations.confirm(actor, id);
        result = response(
          outcome === 'succeeded'
            ? copy(
                locale,
                'Server přijal požadavek. Ověřte jeho výsledek na herním serveru.',
                'The server accepted the request. Verify its effect on the game server.',
              )
            : outcome === 'failed'
              ? copy(
                  locale,
                  'Zásah se nezdařil. Před další žádostí ověřte stav serveru.',
                  'The operation failed. Check the server state before another request.',
                )
              : copy(
                  locale,
                  'Výsledek zásahu není známý. Neopakujte jej automaticky; nejdřív ověřte stav serveru.',
                  'The operation outcome is unknown. Do not retry automatically; first verify the server state.',
                ),
        );
      }
      // Visual cleanup is best-effort; the service's atomic claim provides replay safety.
      try {
        await interaction.clearSourceComponents();
      } catch {
        /* Preserve the durable outcome when a message cannot be edited. */
      }
    }
  } catch (error) {
    result = response(safeError(error, locale));
  }
  await interaction.editReply(result);
}
