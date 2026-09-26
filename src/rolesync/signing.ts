import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { RoleSyncEvent } from '../contracts.js';

export const ROLE_SYNC_PATH = '/api/integrations/discord/role-sync';
const MAX_BODY_BYTES = 65_536;
const id = z.string().regex(/^[1-9][0-9]{0,19}$/);
const eventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.uuid(),
    guildId: id,
    userId: id,
    roleIds: z
      .array(id)
      .max(250)
      .refine((roles) => new Set(roles).size === roles.length),
    membershipState: z.enum(['present', 'left']),
    observedAt: z.iso.datetime({ offset: false }),
    sequence: z.string().regex(/^[1-9][0-9]{0,29}$/),
  })
  .strict()
  .refine((event) => event.membershipState !== 'left' || event.roleIds.length === 0);

export interface SigningOptions {
  url: string;
  keyId: string;
  secret: string;
  now?: Date;
  nonce?: string;
}
export interface VerificationInput {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  guildId: string;
  keys: Record<string, string>;
  now?: Date;
}

export function validateEvent(value: unknown): RoleSyncEvent {
  const result = eventSchema.safeParse(value);
  if (!result.success) throw new Error('ROLE_SYNC_INVALID_EVENT');
  return result.data;
}

function validateKey(keyId: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('ROLE_SYNC_INVALID_KEY');
  }
}

function signingInput(path: string, keyId: string, timestamp: string, nonce: string, body: string) {
  return `POST\n${path}\n${keyId}\n${timestamp}\n${nonce}\n${body}`;
}

export function signEvent(
  event: RoleSyncEvent,
  options: SigningOptions,
): { body: string; headers: Record<string, string> } {
  const parsed = validateEvent(event);
  validateKey(options.keyId, options.secret);
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new Error('ROLE_SYNC_INVALID_URL');
  }
  if (url.pathname !== ROLE_SYNC_PATH || url.search || url.hash || url.username || url.password)
    throw new Error('ROLE_SYNC_INVALID_URL');
  // Schema order is stable even after PostgreSQL jsonb rearranges object keys.
  const body = JSON.stringify(parsed);
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('ROLE_SYNC_INVALID_EVENT');
  const timestamp = String(Math.floor((options.now ?? new Date()).getTime() / 1_000));
  const nonce = options.nonce ?? randomBytes(16).toString('hex');
  if (!/^[0-9]{1,12}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce))
    throw new Error('ROLE_SYNC_INVALID_ENVELOPE');
  const signature = createHmac('sha256', options.secret)
    .update(signingInput(url.pathname, options.keyId, timestamp, nonce, body), 'utf8')
    .digest('hex');
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Valkyria-Key-Id': options.keyId,
      'X-Valkyria-Timestamp': timestamp,
      'X-Valkyria-Nonce': nonce,
      'X-Valkyria-Signature': signature,
    },
  };
}

/** Authenticates one envelope only. The consumer must atomically enforce durable replay/order rules. */
export function verifySignedEvent(input: VerificationInput): RoleSyncEvent {
  if (
    input.method !== 'POST' ||
    input.path !== ROLE_SYNC_PATH ||
    Buffer.byteLength(input.body, 'utf8') > MAX_BODY_BYTES
  )
    throw new Error('ROLE_SYNC_INVALID_ENVELOPE');
  let headers: Headers;
  try {
    headers = new Headers(input.headers);
  } catch {
    throw new Error('ROLE_SYNC_INVALID_ENVELOPE');
  }
  const keyId = headers.get('X-Valkyria-Key-Id') ?? '';
  const timestamp = headers.get('X-Valkyria-Timestamp') ?? '';
  const nonce = headers.get('X-Valkyria-Nonce') ?? '';
  const signature = headers.get('X-Valkyria-Signature') ?? '';
  if (
    !Object.hasOwn(input.keys, keyId) ||
    !/^[0-9]{1,12}$/.test(timestamp) ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new Error('ROLE_SYNC_INVALID_SIGNATURE');
  const secret = input.keys[keyId]!;
  validateKey(keyId, secret);
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(now) || Math.abs(now - Number(timestamp) * 1_000) > 300_000)
    throw new Error('ROLE_SYNC_EXPIRED_ENVELOPE');
  const expected = createHmac('sha256', secret)
    .update(signingInput(input.path, keyId, timestamp, nonce, input.body), 'utf8')
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new Error('ROLE_SYNC_INVALID_SIGNATURE');
  let data: unknown;
  try {
    data = JSON.parse(input.body);
  } catch {
    throw new Error('ROLE_SYNC_INVALID_EVENT');
  }
  const parsed = validateEvent(data);
  if (parsed.guildId !== input.guildId) throw new Error('ROLE_SYNC_WRONG_GUILD');
  if (Date.parse(parsed.observedAt) > now + 300_000) throw new Error('ROLE_SYNC_INVALID_EVENT');
  return parsed;
}
