import {
  SlashCommandBuilder,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { BotConfig } from '../contracts.js';

const english = (value: string) => ({ 'en-US': value, 'en-GB': value });
function language(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName('language')
    .setDescription('Jazyk odpovědi; výchozí je čeština.')
    .setDescriptionLocalizations(english('Response language; Czech is the default.'))
    .setRequired(false)
    .addChoices({ name: 'Čeština', value: 'cs' }, { name: 'English', value: 'en' });
}
function textOption(name: string, cs: string, en: string, max: number, min = 1) {
  return (option: SlashCommandStringOption) =>
    option
      .setName(name)
      .setDescription(cs)
      .setDescriptionLocalizations(english(en))
      .setRequired(true)
      .setMinLength(min)
      .setMaxLength(max);
}

export function buildCommands(
  config: BotConfig,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  if (config.servers.length < 1 || config.servers.length > 25)
    throw new Error('invalid_server_choices');
  const server = (option: SlashCommandStringOption) =>
    option
      .setName('server')
      .setDescription('Vybraný herní server.')
      .setDescriptionLocalizations(english('Selected game server.'))
      .setRequired(true)
      .addChoices(...config.servers.map((entry) => ({ name: entry.label, value: entry.id })));
  const subcommand =
    (
      name: string,
      cs: string,
      en: string,
      options: ((option: SlashCommandStringOption) => SlashCommandStringOption)[] = [],
    ) =>
    (sub: SlashCommandSubcommandBuilder) => {
      sub
        .setName(name)
        .setDescription(cs)
        .setDescriptionLocalizations(english(en))
        .addStringOption(server);
      for (const option of options) sub.addStringOption(option);
      return sub.addStringOption(language);
    };
  const steamId = textOption(
    'steam_id',
    'SteamID64 cílového hráče.',
    'Target player SteamID64.',
    17,
    17,
  );
  const reason = textOption('reason', 'Důvod zásahu.', 'Reason for the action.', 200);
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Zobrazí dostupné příkazy a nápovědu.')
      .setDescriptionLocalizations(english('Shows commands and help.'))
      .addStringOption(language),
    new SlashCommandBuilder()
      .setName('account')
      .setDescription('Zobrazí členství a vaše oprávnění.')
      .setDescriptionLocalizations(english('Shows membership and your permissions.'))
      .addStringOption(language),
    new SlashCommandBuilder()
      .setName('server')
      .setDescription('Informace o herních serverech.')
      .setDescriptionLocalizations(english('Game server information.'))
      .addSubcommand(
        subcommand(
          'status',
          'Zobrazí stav vybraného serveru.',
          'Shows the selected server status.',
        ),
      )
      .addSubcommand(
        subcommand(
          'players',
          'Zobrazí hráče na vybraném serveru.',
          'Shows players on the selected server.',
        ),
      ),
    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('Správa herních serverů s potvrzením.')
      .setDescriptionLocalizations(english('Game server operations with confirmation.'))
      .setDefaultMemberPermissions(0n)
      .addSubcommand(
        subcommand(
          'broadcast',
          'Připraví zprávu všem hráčům.',
          'Prepares a message to all players.',
          [textOption('message', 'Text zprávy hráčům.', 'Message to players.', 200)],
        ),
      )
      .addSubcommand(
        subcommand('kick', 'Připraví odpojení hráče.', 'Prepares to disconnect a player.', [
          steamId,
          reason,
        ]),
      )
      .addSubcommand(
        subcommand('ban', 'Připraví zákaz přístupu hráče.', 'Prepares to ban a player.', [
          steamId,
          reason,
        ]),
      )
      .addSubcommand(
        subcommand('unban', 'Připraví zrušení zákazu hráče.', 'Prepares to unban a player.', [
          steamId,
        ]),
      )
      .addSubcommand(
        subcommand('map', 'Připraví změnu mapy.', 'Prepares to change the map.', [
          textOption('map', 'Přesný název mapy.', 'Exact map name.', 80),
        ]),
      )
      .addSubcommand(
        subcommand(
          'restart',
          'Připraví restart probíhajícího zápasu.',
          'Prepares to restart the current match.',
        ),
      ),
  ].map((command) => command.toJSON());
}
