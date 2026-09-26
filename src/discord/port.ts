import type { Interaction } from 'discord.js';
import type { InteractionInput, InteractionPort } from './handler.js';

export function portFor(interaction: Interaction): InteractionPort | null {
  const base = { id: interaction.id, guildId: interaction.guildId, userId: interaction.user.id };
  let input: InteractionInput;
  if (interaction.isChatInputCommand()) {
    const options: Record<string, string | undefined> = {};
    for (const name of ['server', 'language', 'message', 'steam_id', 'reason', 'map'])
      options[name] = interaction.options.getString(name) ?? undefined;
    const subcommand = interaction.options.getSubcommand(false);
    input = {
      ...base,
      kind: 'command',
      commandName: interaction.commandName,
      options,
      ...(subcommand ? { subcommand } : {}),
    };
  } else if (interaction.isButton())
    input = { ...base, kind: 'button', customId: interaction.customId };
  else return null;
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return null;
  return {
    input,
    deferReply: (options) => interaction.deferReply(options),
    editReply: (response) => interaction.editReply(response),
    clearSourceComponents: async () => {
      if (interaction.isButton())
        await interaction.webhook.editMessage(interaction.message.id, { components: [] });
    },
  };
}
