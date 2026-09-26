import { z } from 'zod';
import type { BotConfig } from '../contracts.js';
import {
  ManagementError,
  type ManagementSettings,
  type ManagementSettingsSnapshot,
} from './types.js';

export const revisionSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const label = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => printable(value) && !/[<>@]/.test(value));
function printable(value: string) {
  return [...value].every(
    (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
}
const settingsSchema = z
  .object({
    defaultLocale: z.enum(['cs', 'en']),
    serverLabels: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), label),
  })
  .strict();
export function validateManagementSettings(value: unknown, config: BotConfig): ManagementSettings {
  const result = settingsSchema.safeParse(value);
  if (
    !result.success ||
    Object.keys(result.data.serverLabels).sort().join(',') !==
      config.servers
        .map((server) => server.id)
        .sort()
        .join(',')
  )
    throw new ManagementError('MANAGEMENT_INVALID_SETTINGS');
  return result.data;
}
export function initialManagementSettings(config: BotConfig): ManagementSettingsSnapshot {
  return {
    revision: '0',
    settings: validateManagementSettings(
      {
        defaultLocale: config.defaultLocale,
        serverLabels: Object.fromEntries(config.servers.map((server) => [server.id, server.label])),
      },
      config,
    ),
  };
}
export function parseSettingsUpdate(value: unknown, config: BotConfig) {
  const parsed = z
    .object({
      expectedRevision: revisionSchema,
      settings: z.unknown(),
      reason: z.string().trim().min(1).max(200).refine(printable),
      correlationId: z.uuid(),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw new ManagementError('MANAGEMENT_INVALID_SETTINGS');
  return { ...parsed.data, settings: validateManagementSettings(parsed.data.settings, config) };
}
