import { readFile } from 'node:fs/promises';
import { parseConfig } from './config.js';
import { BotError } from './errors.js';
export async function readConfig() {
  try {
    return parseConfig(
      JSON.parse(await readFile(process.env.BOT_CONFIG_FILE ?? 'config/bot.json', 'utf8')),
    );
  } catch {
    throw new BotError('invalid_configuration');
  }
}
export function healthOptions() {
  const port = Number(process.env.HEALTH_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new BotError('invalid_configuration');
  return { port, host: process.env.HEALTH_HOST ?? '127.0.0.1' };
}
