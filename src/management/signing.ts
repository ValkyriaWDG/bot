import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../contracts.js';
import {
  ManagementError,
  type ManagementConfig,
  type ManagementIdentity,
  type ManagementScope,
} from './types.js';

export const MANAGEMENT_SETTINGS_PATH = '/api/management/v1/settings';
export const MANAGEMENT_STATUS_PATH = '/api/management/v1/status';
export const MAX_MANAGEMENT_BODY = 16_384;
export const managementSnowflake = z.string().regex(/^[1-9][0-9]{16,19}$/);
const scope = z.enum(['bot.read', 'bot.configure']);
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const configSchema = z
  .object({
    keys: z
      .record(
        keyId,
        z
          .object({
            secret: z
              .string()
              .min(32)
              .max(256)
              .refine((value) => !/[\r\n]/.test(value)),
            scopes: z
              .array(scope)
              .min(1)
              .max(2)
              .refine((value) => new Set(value).size === value.length),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 4),
    grants: z
      .object({
        'bot.read': z.array(managementSnowflake).max(25),
        'bot.configure': z.array(managementSnowflake).max(25),
      })
      .strict(),
  })
  .strict();
export function parseManagementConfig(value: unknown): ManagementConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) throw new ManagementError('MANAGEMENT_INVALID_CONFIG');
  return result.data;
}
function input(
  method: string,
  path: string,
  key: string,
  timestamp: string,
  nonce: string,
  actor: Actor,
  body: string,
) {
  return `VALKYRIA-MANAGEMENT-V1\n${method}\n${path}\n${key}\n${timestamp}\n${nonce}\n${actor.guildId}\n${actor.userId}\n${body}`;
}
function requestScope(method: string, path: string): ManagementScope {
  if (method === 'GET' && [MANAGEMENT_STATUS_PATH, MANAGEMENT_SETTINGS_PATH].includes(path))
    return 'bot.read';
  if (method === 'PATCH' && path === MANAGEMENT_SETTINGS_PATH) return 'bot.configure';
  throw new ManagementError('MANAGEMENT_NOT_FOUND', 404);
}
export interface SignManagementOptions {
  method: 'GET' | 'PATCH';
  path: string;
  body: string;
  actor: Actor;
  keyId: string;
  secret: string;
  now?: Date;
  nonce?: string;
}
export function signManagementRequest(options: SignManagementOptions): {
  body: string;
  headers: Record<string, string>;
} {
  requestScope(options.method, options.path);
  const timestamp = String(Math.floor((options.now ?? new Date()).getTime() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString('hex');
  if (
    !keyId.safeParse(options.keyId).success ||
    options.secret.length < 32 ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^\d{1,12}$/.test(timestamp) ||
    !managementSnowflake.safeParse(options.actor.guildId).success ||
    !managementSnowflake.safeParse(options.actor.userId).success ||
    Buffer.byteLength(options.body) > MAX_MANAGEMENT_BODY
  )
    throw new ManagementError('MANAGEMENT_INVALID_ENVELOPE');
  const signature = createHmac('sha256', options.secret)
    .update(
      input(
        options.method,
        options.path,
        options.keyId,
        timestamp,
        nonce,
        options.actor,
        options.body,
      ),
    )
    .digest('hex');
  return {
    body: options.body,
    headers: {
      'Content-Type': 'application/json',
      'X-Valkyria-Management-Key-Id': options.keyId,
      'X-Valkyria-Management-Timestamp': timestamp,
      'X-Valkyria-Management-Nonce': nonce,
      'X-Valkyria-Management-Guild': options.actor.guildId,
      'X-Valkyria-Management-Actor': options.actor.userId,
      'X-Valkyria-Management-Signature': signature,
    },
  };
}
export interface VerifyManagementOptions {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
  config: ManagementConfig;
  guildId: string;
  now?: Date;
}
export function verifyManagementRequest(options: VerifyManagementOptions): ManagementIdentity {
  const required = requestScope(options.method, options.path);
  if (
    Buffer.byteLength(options.body) > MAX_MANAGEMENT_BODY ||
    (options.method === 'GET' && options.body !== '')
  )
    throw new ManagementError('MANAGEMENT_INVALID_BODY');
  const headers = new Headers(options.headers);
  const get = (name: string) => headers.get(`X-Valkyria-Management-${name}`) ?? '';
  const key = get('Key-Id'),
    timestamp = get('Timestamp'),
    nonce = get('Nonce'),
    signature = get('Signature');
  const actor = { guildId: get('Guild'), userId: get('Actor') };
  if (
    !Object.hasOwn(options.config.keys, key) ||
    !/^\d{1,12}$/.test(timestamp) ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !managementSnowflake.safeParse(actor.guildId).success ||
    !managementSnowflake.safeParse(actor.userId).success
  )
    throw new ManagementError('MANAGEMENT_INVALID_SIGNATURE', 401);
  const configured = options.config.keys[key]!;
  const expected = createHmac('sha256', configured.secret)
    .update(input(options.method, options.path, key, timestamp, nonce, actor, options.body))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new ManagementError('MANAGEMENT_INVALID_SIGNATURE', 401);
  const age = (options.now ?? new Date()).getTime() - Number(timestamp) * 1000;
  if (!Number.isFinite(age) || age < -5000 || age > 60_000)
    throw new ManagementError('MANAGEMENT_EXPIRED', 401);
  if (actor.guildId !== options.guildId) throw new ManagementError('MANAGEMENT_WRONG_GUILD', 403);
  if (!configured.scopes.includes(required))
    throw new ManagementError('MANAGEMENT_WRONG_SCOPE', 403);
  return {
    actor,
    keyId: key,
    scope: required,
    nonce,
    method: options.method,
    path: options.path,
    bodyDigest: createHash('sha256').update(options.body).digest('hex'),
    expiresAt: Number(timestamp) * 1000 + 60_000,
  };
}
