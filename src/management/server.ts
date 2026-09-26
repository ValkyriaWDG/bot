import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import {
  managementSnowflake,
  MAX_MANAGEMENT_BODY,
  parseManagementConfig,
  verifyManagementRequest,
  MANAGEMENT_SETTINGS_PATH,
} from './signing.js';
import {
  ManagementError,
  type ManagementOptions,
  type ManagementRuntime,
  type ManagementSettingsSnapshot,
  type ManagementIdentity,
} from './types.js';
import { PostgresManagementStore } from './store.js';
import { parseSettingsUpdate, revisionSchema, validateManagementSettings } from './settings.js';
const shutdowns = new WeakMap<Server, () => Promise<void>>();
export async function closeManagementServer(server: Server, timeoutMs = 15_000): Promise<void> {
  const shutdown = shutdowns.get(server);
  if (!shutdown || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
    throw new ManagementError('MANAGEMENT_INVALID_CONFIG');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      shutdown(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ManagementError('MANAGEMENT_DRAIN_TIMEOUT', 503)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const runtimeSchema = z
  .object({
    build: z
      .object({
        version: z
          .string()
          .regex(/^(?:unknown|\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/)
          .max(80),
        revision: z.string().regex(/^(?:unknown|[a-f0-9]{40})$/),
      })
      .strict(),
    startedAt: z.iso.datetime(),
    observedAt: z.iso.datetime(),
    discord: z.enum(['connected', 'disconnected', 'unknown']),
    database: z.enum(['available', 'unavailable', 'unknown']),
    lease: z.enum(['held', 'lost', 'unknown']),
    effective: z.unknown(),
  })
  .strict();
function runtime(options: ManagementOptions): ManagementRuntime {
  const parsed = runtimeSchema.safeParse(options.getRuntime());
  if (!parsed.success) throw new ManagementError('MANAGEMENT_RUNTIME_UNAVAILABLE', 503);
  let effective: ManagementSettingsSnapshot | null = null;
  if (parsed.data.effective !== null) {
    const snapshot = z
      .object({ revision: revisionSchema, settings: z.unknown() })
      .strict()
      .safeParse(parsed.data.effective);
    if (!snapshot.success) throw new ManagementError('MANAGEMENT_RUNTIME_UNAVAILABLE', 503);
    effective = {
      revision: snapshot.data.revision,
      settings: validateManagementSettings(snapshot.data.settings, options.botConfig),
    };
  }
  return { ...parsed.data, effective };
}
function sameSettings(a: ManagementSettingsSnapshot, b: ManagementSettingsSnapshot) {
  return (
    a.revision === b.revision &&
    a.settings.defaultLocale === b.settings.defaultLocale &&
    Object.keys(a.settings.serverLabels).every(
      (id) => a.settings.serverLabels[id] === b.settings.serverLabels[id],
    )
  );
}
async function bodyOf(request: IncomingMessage, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: Error, value?: string) => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', errorHandler);
      request.off('aborted', aborted);
      signal.removeEventListener('abort', aborted);
      if (error) {
        request.resume();
        reject(error);
      } else resolve(value ?? '');
    };
    const aborted = () => finish(new ManagementError('MANAGEMENT_TIMEOUT', 504));
    const errorHandler = () => finish(new ManagementError('MANAGEMENT_INVALID_BODY'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MANAGEMENT_BODY) finish(new ManagementError('MANAGEMENT_BODY_TOO_LARGE', 413));
      else chunks.push(chunk);
    };
    const end = () => {
      try {
        finish(undefined, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        finish(new ManagementError('MANAGEMENT_INVALID_BODY'));
      }
    };
    request.on('data', data);
    request.once('end', end);
    request.once('error', errorHandler);
    request.once('aborted', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
export function createManagementServer(options: ManagementOptions) {
  const config = parseManagementConfig(options.config);
  const timeout = options.requestTimeoutMs ?? 5000,
    limit = options.rateLimitPerMinute ?? 120;
  if (
    !Number.isInteger(timeout) ||
    timeout < 100 ||
    timeout > 10_000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 600
  )
    throw new ManagementError('MANAGEMENT_INVALID_CONFIG');
  const now = options.now ?? (() => new Date()),
    store = new PostgresManagementStore(options.pool, options.botConfig);
  let windowStart = Date.now(),
    requests = 0;
  let mutations: Promise<unknown> = Promise.resolve();
  const handlers = new Set<Promise<void>>();
  const abortRequests = new Set<() => void>();
  let closing = false;
  const serialize = <T>(work: () => Promise<T>) => {
    const result = mutations.catch(() => undefined).then(work);
    mutations = result;
    return result;
  };
  const configuration = async () => {
    const saved = await store.readState(),
      actual = runtime(options);
    const applyState =
      actual.effective && sameSettings(saved.desired, actual.effective)
        ? 'applied'
        : saved.applyError
          ? 'error'
          : actual.effective
            ? 'pending'
            : 'unknown';
    return { desired: saved.desired, effective: actual.effective, applyState };
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const controller = new AbortController();
    const send = (status: number, value: unknown) => {
      if (!response.writableEnded && !response.destroyed) {
        if (status >= 400) response.setHeader('Connection', 'close');
        response.writeHead(status).end(JSON.stringify(value));
      }
    };
    const abort = () => {
      controller.abort();
      send(503, { code: 'MANAGEMENT_SHUTTING_DOWN' });
    };
    abortRequests.add(abort);
    const timer = setTimeout(() => {
      controller.abort();
      send(504, { code: 'MANAGEMENT_TIMEOUT' });
    }, timeout);
    const active = (identity?: ManagementIdentity) => {
      if (controller.signal.aborted || response.destroyed)
        throw new ManagementError('MANAGEMENT_TIMEOUT', 504);
      if (identity && now().getTime() > identity.expiresAt)
        throw new ManagementError('MANAGEMENT_EXPIRED', 401);
    };
    let identity: ManagementIdentity | undefined;
    let committed = false;
    try {
      if (closing) throw new ManagementError('MANAGEMENT_SHUTTING_DOWN', 503);
      if (Date.now() - windowStart >= 60_000) {
        windowStart = Date.now();
        requests = 0;
      }
      if (++requests > limit) {
        response.setHeader('Retry-After', '60');
        throw new ManagementError('MANAGEMENT_RATE_LIMITED', 429);
      }
      if (
        request.headers.origin ||
        (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')
      )
        throw new ManagementError('MANAGEMENT_INVALID_ENVELOPE', 401);
      if (
        request.method === 'PATCH' &&
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
      )
        throw new ManagementError('MANAGEMENT_INVALID_BODY');
      const headers: Record<string, string> = {},
        seen = new Set<string>();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const key = request.rawHeaders[i]!.toLowerCase();
        if (key.startsWith('x-valkyria-management-') && seen.has(key))
          throw new ManagementError('MANAGEMENT_INVALID_ENVELOPE', 401);
        seen.add(key);
        headers[key] = request.rawHeaders[i + 1]!;
      }
      const body = await bodyOf(request, controller.signal);
      active();
      identity = verifyManagementRequest({
        method: request.method ?? '',
        path: request.url ?? '',
        body,
        headers,
        config,
        guildId: options.botConfig.guildId,
        now: now(),
      });
      await store.consume(identity);
      active(identity);
      const authorize = async () => {
        active(identity);
        let member;
        try {
          member = await Promise.race([
            options.members.fetch(identity!.actor.guildId, identity!.actor.userId),
            new Promise<never>((_resolve, reject) => {
              controller.signal.addEventListener(
                'abort',
                () => reject(new ManagementError('MANAGEMENT_TIMEOUT', 504)),
                { once: true },
              );
            }),
          ]);
        } catch (error) {
          if (error instanceof ManagementError) throw error;
          throw new ManagementError('MANAGEMENT_MEMBERSHIP_UNAVAILABLE', 403);
        }
        active(identity);
        const age = now().getTime() - Date.parse(member.observedAt);
        if (
          member.guildId !== identity!.actor.guildId ||
          member.userId !== identity!.actor.userId ||
          member.state !== 'present' ||
          !Number.isFinite(age) ||
          age < -5000 ||
          age > 60_000 ||
          !Array.isArray(member.roleIds) ||
          member.roleIds.length > 250 ||
          !member.roleIds.every((value) => managementSnowflake.safeParse(value).success) ||
          !config.grants[identity!.scope].some((role) => member.roleIds.includes(role))
        )
          throw new ManagementError('MANAGEMENT_FORBIDDEN', 403);
      };
      await authorize();
      if (request.method === 'PATCH') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new ManagementError('MANAGEMENT_INVALID_BODY');
        }
        const update = parseSettingsUpdate(parsed, options.botConfig);
        await serialize(async () => {
          active(identity);
          const canApply = () => {
            const current = runtime(options),
              age = now().getTime() - Date.parse(current.observedAt);
            if (
              age < -5000 ||
              age > 30_000 ||
              current.lease !== 'held' ||
              current.database !== 'available' ||
              current.discord !== 'connected'
            )
              throw new ManagementError('MANAGEMENT_RUNTIME_UNAVAILABLE', 503);
          };
          canApply();
          const snapshot = await store.update(
            identity!,
            update,
            async () => {
              await authorize();
              canApply();
              active(identity);
            },
            () => {
              canApply();
              active(identity);
            },
          );
          committed = true;
          try {
            active(identity);
            await options.applySettings(structuredClone(snapshot));
          } catch {
            await store.applyFailed(snapshot.revision);
          }
        });
        active(identity);
        const value = await configuration();
        active(identity);
        send(value.applyState === 'applied' ? 200 : 202, { schemaVersion: 1, ...value });
      } else {
        await store.audit(identity, 'MANAGEMENT_READ');
        active(identity);
        const current = await configuration();
        if (request.url === MANAGEMENT_SETTINGS_PATH) {
          active(identity);
          send(200, { schemaVersion: 1, ...current });
        } else {
          const actual = runtime(options),
            age = now().getTime() - Date.parse(actual.observedAt),
            outbox = await store.outboxStatus();
          active(identity);
          const state =
            age < -5000 || age > 30_000
              ? 'stale'
              : actual.discord === 'unknown' ||
                  actual.database === 'unknown' ||
                  actual.lease === 'unknown'
                ? 'unknown'
                : actual.discord === 'connected' &&
                    actual.database === 'available' &&
                    actual.lease === 'held'
                  ? 'healthy'
                  : 'degraded';
          const roleState = !options.botConfig.roleSync.enabled
            ? 'disabled'
            : outbox.failed > 0 ||
                (outbox.oldestPendingAt &&
                  now().getTime() - Date.parse(outbox.oldestPendingAt) > 60_000)
              ? 'degraded'
              : !outbox.lastDeliveredAt
                ? 'unknown'
                : now().getTime() - Date.parse(outbox.lastDeliveredAt) > 300_000
                  ? 'stale'
                  : 'healthy';
          const safeRuntime = {
            build: actual.build,
            startedAt: actual.startedAt,
            observedAt: actual.observedAt,
            discord: actual.discord,
            database: actual.database,
            lease: actual.lease,
          };
          send(200, {
            schemaVersion: 1,
            observedAt: now().toISOString(),
            runtime: { ...safeRuntime, state },
            configuration: {
              desiredRevision: current.desired.revision,
              effectiveRevision: current.effective?.revision ?? null,
              applyState: current.applyState,
            },
            roleSync: { enabled: options.botConfig.roleSync.enabled, state: roleState, ...outbox },
          });
        }
      }
    } catch (error) {
      let failure =
        error instanceof ManagementError
          ? error
          : new ManagementError('MANAGEMENT_STORAGE_UNAVAILABLE', 503);
      if (identity && !committed && !controller.signal.aborted) {
        try {
          await store.audit(identity, failure.code);
        } catch {
          failure = new ManagementError('MANAGEMENT_STORAGE_UNAVAILABLE', 503);
        }
      }
      send(failure.status, { code: failure.code });
    } finally {
      clearTimeout(timer);
      abortRequests.delete(abort);
    }
  };
  const server = createServer((request, response) => {
    const pending = handle(request, response);
    handlers.add(pending);
    const finished = () => {
      handlers.delete(pending);
    };
    void pending.then(finished, finished);
  });
  let drained: Promise<void> | undefined;
  shutdowns.set(server, () => {
    if (drained) return drained;
    closing = true;
    for (const abort of abortRequests) abort();
    const connectionsClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeAllConnections();
    drained = (async () => {
      while (handlers.size) await Promise.allSettled([...handlers]);
      await connectionsClosed;
    })();
    return drained;
  });
  server.requestTimeout = timeout;
  server.headersTimeout = timeout;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.maxConnections = 64;
  return server;
}
