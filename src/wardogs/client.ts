import type { GameServer, Player, ServerAction, ServerStatus } from '../contracts.js';
import { z } from 'zod';

export interface WardogsClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  allowInsecureLoopback?: boolean;
}

export type RconErrorCode =
  | 'invalid_configuration'
  | 'invalid_action'
  | 'invalid_map'
  | 'unsupported_action'
  | 'accepted_unverified'
  | 'invalid_response'
  | 'response_too_large'
  | 'request_too_large'
  | 'rate_limited'
  | 'redirect_refused'
  | 'http_error'
  | 'timeout'
  | 'transport_error';

export class RconError extends Error {
  readonly name = 'RconError';
  constructor(
    readonly code: RconErrorCode,
    readonly outcome: 'failed' | 'unknown' = 'failed',
    readonly retryAfterSeconds: number | undefined = undefined,
  ) {
    super(
      code === 'invalid_configuration'
        ? 'Invalid RCON configuration.'
        : `RCON request failed (${code}).`,
    );
  }
}

const MAX_BYTES = 1024 * 1024;
const steamId = z.string().regex(/^[0-9]{17}$/);
const cleanText = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
    );
const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const statusSchema = z.object({
  serverName: z.string().min(1).max(256),
  map: z.string().min(1).max(256),
  players: z.object({ current: nonnegative.max(10000), max: nonnegative.min(1).max(10000) }),
  matchSeconds: nonnegative.nullish(),
});
const playersSchema = z.object({
  players: z
    .array(
      z.object({
        steamId: steamId.nullish().transform((value) => value ?? null),
        name: z.string().min(1).max(256),
        faction: z.string().max(128),
        kills: nonnegative,
        deaths: nonnegative,
        pingMs: nonnegative,
      }),
    )
    .max(1000),
});
const capabilitiesSchema = z.object({ routes: z.array(z.string().max(256)).max(512) });
const mapsSchema = z.object({
  maps: z.array(z.object({ id: z.string().min(1).max(128) })).max(1000),
});
const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('broadcast'), message: cleanText(200) }),
  z.strictObject({ type: z.literal('kick'), steamId, reason: cleanText(200) }),
  z.strictObject({ type: z.literal('ban'), steamId, reason: cleanText(200) }),
  z.strictObject({ type: z.literal('unban'), steamId }),
  z.strictObject({ type: z.literal('map'), map: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
  z.strictObject({ type: z.literal('restart') }),
]);
type Mutation = { method: 'POST' | 'DELETE'; path: string; capability: string; body?: object };

const normalizeRoute = (route: string) =>
  route
    .trim()
    .replace(/\{[^}]*\}|:[^/\s]+/g, '*')
    .replace(/\s+/g, ' ');

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RconError('invalid_response');
  return parsed.data;
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^[0-9]+$/.test(value)) return Math.min(86400, Number(value));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(86400, Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)));
}

function mutationFor(action: ServerAction): Mutation {
  switch (action.type) {
    case 'broadcast':
      return {
        method: 'POST',
        path: '/v1/broadcast',
        capability: 'POST /v1/broadcast',
        body: { message: action.message },
      };
    case 'kick':
      return {
        method: 'POST',
        path: `/v1/players/${encodeURIComponent(action.steamId)}/kick`,
        capability: 'POST /v1/players/*/kick',
        body: { reason: action.reason },
      };
    case 'ban':
      return {
        method: 'POST',
        path: '/v1/bans',
        capability: 'POST /v1/bans',
        body: { steamId: action.steamId, reason: action.reason },
      };
    case 'unban':
      return {
        method: 'DELETE',
        path: `/v1/bans/${encodeURIComponent(action.steamId)}`,
        capability: 'DELETE /v1/bans/*',
      };
    case 'map':
      return {
        method: 'POST',
        path: '/v1/match/map',
        capability: 'POST /v1/match/map',
        body: { map: action.map },
      };
    case 'restart':
      return { method: 'POST', path: '/v1/match/restart', capability: 'POST /v1/match/restart' };
  }
}

export class WardogsClient implements GameServer {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #timeoutMs: number;

  constructor(options: WardogsClientOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new RconError('invalid_configuration');
    }
    const loopback =
      options.allowInsecureLoopback === true &&
      /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/.test(options.baseUrl);
    const timeout = options.timeoutMs ?? 5000;
    if (
      (url.protocol !== 'https:' && !loopback) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      typeof options.token !== 'string' ||
      options.token.length < 1 ||
      options.token.length > 4096 ||
      [...options.token].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) >= 127) ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 10000
    ) {
      throw new RconError('invalid_configuration');
    }
    this.#baseUrl = url.origin;
    this.#token = options.token;
    this.#timeoutMs = timeout;
  }

  async status(): Promise<ServerStatus> {
    const data = parseResponse(statusSchema, await this.#request('GET', '/v1/status'));
    return {
      serverName: data.serverName,
      map: data.map,
      playerCount: data.players.current,
      maxPlayers: data.players.max,
      matchSeconds: data.matchSeconds ?? null,
    };
  }

  async players(): Promise<Player[]> {
    return parseResponse(playersSchema, await this.#request('GET', '/v1/players')).players;
  }

  async execute(input: ServerAction): Promise<void> {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw new RconError('invalid_action');
    const action = parsed.data;
    const mutation = mutationFor(action);
    const capabilities = parseResponse(
      capabilitiesSchema,
      await this.#request('GET', '/v1/capabilities'),
    );
    if (!capabilities.routes.map(normalizeRoute).includes(mutation.capability)) {
      throw new RconError('unsupported_action');
    }
    if (action.type === 'map') {
      const catalog = parseResponse(mapsSchema, await this.#request('GET', '/v1/catalog/maps'));
      if (!catalog.maps.some((map) => map.id === action.map)) throw new RconError('invalid_map');
    }
    await this.#request(mutation.method, mutation.path, mutation.body);
  }

  async #request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<unknown> {
    const mutating = method !== 'GET';
    const ambiguous = mutating ? 'unknown' : 'failed';
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined && Buffer.byteLength(serialized) > MAX_BYTES) {
      throw new RconError('request_too_large');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: 'application/json',
          ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new RconError('redirect_refused', ambiguous);
      }
      if (mutating && response.status === 202) {
        await response.body?.cancel();
        throw new RconError('accepted_unverified', 'unknown');
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429)
          throw new RconError(
            'rate_limited',
            'failed',
            retryAfter(response.headers.get('Retry-After')),
          );
        throw new RconError('http_error', response.status >= 500 ? ambiguous : 'failed');
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) {
              await reader.cancel();
              throw new RconError('response_too_large', ambiguous);
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      if (mutating && length === 0) return undefined;
      let result: unknown;
      try {
        result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new RconError('invalid_response', ambiguous);
      }
      if (typeof result !== 'object' || result === null || Array.isArray(result)) {
        throw new RconError('invalid_response', ambiguous);
      }
      // Success payloads are not fully specified; never infer success from an explicit error.
      if ('error' in result || ('ok' in result && result.ok === false)) {
        throw new RconError('invalid_response', ambiguous);
      }
      return result;
    } catch (error) {
      if (error instanceof RconError) throw error;
      throw new RconError(controller.signal.aborted ? 'timeout' : 'transport_error', ambiguous);
    } finally {
      clearTimeout(timer);
    }
  }
}
