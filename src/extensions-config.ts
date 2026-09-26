import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { BotConfig } from './contracts.js';
import { destinationSchema } from './publications/contracts.js';

const envName = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const snowflake = z.string().regex(/^[1-9][0-9]{16,19}$/);
const credential = z.object({ keyId, secretEnv: envName }).strict();
const scope = z.enum(['bot.read', 'bot.configure']);
const managementSchema = z
  .object({
    enabled: z.boolean().default(false),
    // Exposure is an operator/network choice; no address is supplied by the web UI.
    host: z.enum(['127.0.0.1', '::1', '0.0.0.0']).default('127.0.0.1'),
    port: z.number().int().min(1024).max(65535).default(3001),
    keys: z
      .record(
        keyId,
        z.object({ secretEnv: envName, scopes: z.array(scope).min(1).max(2) }).strict(),
      )
      .default({}),
    grants: z
      .object({
        'bot.read': z.array(snowflake).max(25).default([]),
        'bot.configure': z.array(snowflake).max(25).default([]),
      })
      .strict()
      .default({ 'bot.read': [], 'bot.configure': [] }),
  })
  .strict();
const boardSchema = z
  .object({
    destination: destinationSchema.refine((d) => d.purpose === 'status'),
    serverId: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    label: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s)),
    pollSeconds: z.number().int().min(30).max(300),
    freshForSeconds: z.number().int().min(60).max(600),
  })
  .strict()
  .refine((b) => b.freshForSeconds >= b.pollSeconds * 2);
const schema = z
  .object({
    management: managementSchema.default(() => managementSchema.parse({})),
    website: z.object({ publications: credential, signup: credential }).strict().optional(),
    publications: z
      .object({
        enabled: z.boolean().default(false),
        pollSeconds: z.number().int().min(10).max(300).default(15),
        destinations: z
          .array(destinationSchema.refine((d) => d.purpose !== 'status'))
          .max(20)
          .default([]),
        boards: z.array(boardSchema).max(20).default([]),
      })
      .strict()
      .default({ enabled: false, pollSeconds: 15, destinations: [], boards: [] }),
    signup: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .default({ enabled: false }),
  })
  .strict();
export type ExtensionsConfig = z.infer<typeof schema>;

export function parseExtensionsConfig(input: unknown, bot: BotConfig): ExtensionsConfig {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_extensions_configuration');
  const cfg = parsed.data;
  const destinations = [
    ...cfg.publications.destinations,
    ...cfg.publications.boards.map((b) => b.destination),
  ];
  const id = (d: (typeof destinations)[number]) =>
    `${d.guildId}:${d.channelId}:${d.locale}:${d.purpose}`;
  const destinationIds = [
    ...cfg.publications.destinations.map(id),
    ...cfg.publications.boards.map((b) => `${id(b.destination)}:${b.serverId}`),
  ];
  if (
    (cfg.management.enabled && Object.keys(cfg.management.keys).length === 0) ||
    Object.keys(cfg.management.keys).length > 4 ||
    ((cfg.publications.enabled || cfg.signup.enabled) && !cfg.website) ||
    destinations.some((d) => d.guildId !== bot.guildId) ||
    new Set(destinationIds).size !== destinationIds.length ||
    cfg.publications.boards.some((b) => !bot.servers.some((s) => s.id === b.serverId))
  ) {
    throw new Error('invalid_extensions_configuration');
  }
  return cfg;
}

export async function readExtensionsConfig(
  bot: BotConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExtensionsConfig> {
  if (!env.BOT_EXTENSIONS_FILE) return parseExtensionsConfig({}, bot);
  try {
    return parseExtensionsConfig(JSON.parse(await readFile(env.BOT_EXTENSIONS_FILE, 'utf8')), bot);
  } catch {
    throw new Error('invalid_extensions_configuration');
  }
}

export function resolveExtensionSecrets(
  cfg: ExtensionsConfig,
  bot: BotConfig,
  env: NodeJS.ProcessEnv,
) {
  const used = new Set<string>(
    [
      env[bot.roleSync.secretEnv],
      env.DISCORD_BOT_TOKEN,
      ...bot.servers.map((s) => env[s.tokenEnv]),
    ].filter((value): value is string => Boolean(value)),
  );
  const resolve = (name: string) => {
    const value = env[name];
    if (!value || Buffer.byteLength(value, 'utf8') < 32 || /[\r\n]/.test(value) || used.has(value))
      throw new Error('invalid_extensions_credentials');
    used.add(value);
    return value;
  };
  const management: Record<string, { secret: string; scopes: ('bot.read' | 'bot.configure')[] }> =
    {};
  if (cfg.management.enabled)
    for (const [id, key] of Object.entries(cfg.management.keys))
      management[id] = { secret: resolve(key.secretEnv), scopes: key.scopes };
  const website =
    (cfg.publications.enabled || cfg.signup.enabled) && cfg.website
      ? {
          publications: {
            keyId: cfg.website.publications.keyId,
            secret: resolve(cfg.website.publications.secretEnv),
          },
          signup: {
            keyId: cfg.website.signup.keyId,
            secret: resolve(cfg.website.signup.secretEnv),
          },
        }
      : null;
  return { management, website };
}
