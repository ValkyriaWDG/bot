import { REST, Routes } from 'discord.js';
import { buildCommands } from '../discord/commands.js';
import { readConfig } from '../runtime-config.js';
import { requiredSecret } from '../config.js';
import { BotError } from '../errors.js';

async function main() {
  const config = await readConfig();
  const commands = buildCommands(config);
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(
      JSON.stringify(
        { mode: 'dry-run', applicationId: config.applicationId, guildId: config.guildId, commands },
        null,
        2,
      ),
    );
    return;
  }
  if (
    args.length !== 5 ||
    args[0] !== '--apply' ||
    args[1] !== '--guild' ||
    args[2] !== config.guildId ||
    args[3] !== '--application' ||
    args[4] !== config.applicationId
  )
    throw new BotError('registration_target_mismatch');
  const rest = new REST({
    version: '10',
    timeout: 5000,
    retries: 0,
    rejectOnRateLimit: () => true,
  }).setToken(requiredSecret(process.env, 'DISCORD_BOT_TOKEN'));
  await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), {
    body: commands,
  });
  console.log(JSON.stringify({ event: 'guild_commands_registered', count: commands.length }));
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'registration_failed',
      code: error instanceof BotError ? error.code : 'discord_unavailable',
    }),
  );
  process.exitCode = 1;
});
