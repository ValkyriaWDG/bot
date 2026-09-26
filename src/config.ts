import { z } from 'zod';
import type { BotConfig } from './contracts.js';
import { BotError } from './errors.js';

export const snowflake = z.string().regex(/^[0-9]{17,20}$/);
const capability = z.enum([
  'server.status',
  'server.players',
  'server.broadcast',
  'server.moderate',
  'server.control',
]);
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const url = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      !parsed.search
    );
  });
const origin = url.refine((value) => new URL(value).pathname === '/');
const server = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    label: z.string().trim().min(1).max(60),
    baseUrl: origin,
    tokenEnv: envName,
    grants: z.partialRecord(capability, z.array(snowflake).min(1).max(25)),
  })
  .strict();
const schema = z
  .object({
    guildId: snowflake,
    applicationId: snowflake,
    defaultLocale: z.enum(['cs', 'en']),
    websiteUrl: origin,
    servers: z
      .array(server)
      .min(1)
      .max(25)
      .refine((items) => new Set(items.map((s) => s.id)).size === items.length),
    roleSync: z
      .object({
        enabled: z.boolean(),
        url: url.refine(
          (value) => new URL(value).pathname === '/api/integrations/discord/role-sync',
        ),
        keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        secretEnv: envName,
        reconcileSeconds: z.number().int().min(30).max(3600),
      })
      .strict(),
  })
  .strict();

export function parseConfig(input: unknown): BotConfig {
  const result = schema.safeParse(input);
  if (!result.success) throw new BotError('invalid_configuration');
  return result.data;
}

export function requiredSecret(env: NodeJS.ProcessEnv, name: string, minLength = 1): string {
  const value = env[name];
  if (!value || value.length < minLength || /[\r\n]/.test(value))
    throw new BotError('missing_configuration');
  return value;
}
