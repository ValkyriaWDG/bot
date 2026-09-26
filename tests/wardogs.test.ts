import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WardogsClient, RconError } from '../src/wardogs/client.js';
import type { ServerAction } from '../src/contracts.js';

const token = 'synthetic-rcon-token';
const steamId = '76561198000000001';
const closers: (() => Promise<void>)[] = [];
type Request = { method: string; path: string; auth: string | undefined; body: string };
type Responder = (req: Request, res: ServerResponse, raw: IncomingMessage) => void;
const reply = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
async function fixture(responder: Responder) {
  const requests: Request[] = [];
  const server = createServer(async (raw, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of raw) chunks.push(Buffer.from(chunk));
    const req = {
      method: raw.method ?? '',
      path: raw.url ?? '',
      auth: raw.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    requests.push(req);
    responder(req, res, raw);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  closers.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    requests,
    baseUrl,
    client: new WardogsClient({ baseUrl, token, allowInsecureLoopback: true }),
  };
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const status = { serverName: 'Synthetic server', map: 'Europe', players: { current: 5, max: 100 } };
const allRoutes = [
  'POST /v1/broadcast',
  'POST /v1/players/{id}/kick',
  'POST /v1/bans',
  'DELETE /v1/bans/:steamId',
  'POST /v1/match/map',
  'POST /v1/match/restart',
];

describe('Wardogs HTTP wire adapter', () => {
  it('reads the observed nested status and keeps unavailable match time unknown', async () => {
    const f = await fixture((_req, res) => reply(res, status));
    await expect(f.client.status()).resolves.toEqual({
      serverName: status.serverName,
      map: 'Europe',
      playerCount: 5,
      maxPlayers: 100,
      matchSeconds: null,
    });
    expect(f.requests).toEqual([
      { method: 'GET', path: '/v1/status', auth: `Bearer ${token}`, body: '' },
    ]);
  });

  it('returns validated player fields without leaking unknown upstream properties', async () => {
    const player = {
      steamId,
      name: 'Test player',
      faction: 'RED',
      kills: 2,
      deaths: 1,
      pingMs: 32,
      secret: token,
    };
    const f = await fixture((_req, res) =>
      reply(res, { players: [player, { ...player, steamId: null, name: 'Unverified' }] }),
    );
    await expect(f.client.players()).resolves.toEqual([
      { steamId, name: 'Test player', faction: 'RED', kills: 2, deaths: 1, pingMs: 32 },
      { steamId: null, name: 'Unverified', faction: 'RED', kills: 2, deaths: 1, pingMs: 32 },
    ]);
    expect(f.requests[0]?.path).toBe('/v1/players');
  });

  it.each([
    [
      { type: 'broadcast', message: 'Synthetic message' },
      'POST',
      '/v1/broadcast',
      { message: 'Synthetic message' },
    ],
    [
      { type: 'kick', steamId, reason: 'Synthetic reason' },
      'POST',
      `/v1/players/${steamId}/kick`,
      { reason: 'Synthetic reason' },
    ],
    [
      { type: 'ban', steamId, reason: 'Synthetic reason' },
      'POST',
      '/v1/bans',
      { steamId, reason: 'Synthetic reason' },
    ],
    [{ type: 'unban', steamId }, 'DELETE', `/v1/bans/${steamId}`, undefined],
    [{ type: 'map', map: 'Europe' }, 'POST', '/v1/match/map', { map: 'Europe' }],
    [{ type: 'restart' }, 'POST', '/v1/match/restart', undefined],
  ] as const)('sends the exact allowlisted mutation for %j', async (action, method, path, body) => {
    const f = await fixture((req, res) => {
      if (req.path === '/v1/capabilities') return reply(res, { routes: allRoutes });
      if (req.path === '/v1/catalog/maps')
        return reply(res, { maps: [{ id: 'Europe', displayName: 'Europe' }] });
      reply(res, { message: 'Accepted' });
    });
    await expect(f.client.execute(action)).resolves.toBeUndefined();
    expect(f.requests[0]?.path).toBe('/v1/capabilities');
    expect(f.requests.at(-1)).toEqual({
      method,
      path,
      auth: `Bearer ${token}`,
      body: body === undefined ? '' : JSON.stringify(body),
    });
    expect(f.requests.filter((req) => req.method !== 'GET')).toHaveLength(1);
  });

  it('rejects unsupported capabilities without dispatching a mutation', async () => {
    const f = await fixture((_req, res) => reply(res, { routes: ['GET /v1/status'] }));
    await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
      code: 'unsupported_action',
      outcome: 'failed',
    });
    expect(f.requests).toHaveLength(1);
  });

  it('refreshes capabilities for each mutation', async () => {
    let probes = 0;
    const f = await fixture((req, res) =>
      req.path === '/v1/capabilities'
        ? reply(res, { routes: ++probes === 1 ? allRoutes : [] })
        : reply(res, {}),
    );
    await f.client.execute({ type: 'restart' });
    await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
      code: 'unsupported_action',
    });
    expect(f.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
  });

  it('rejects unknown catalog map before mutation', async () => {
    const f = await fixture((req, res) =>
      reply(
        res,
        req.path === '/v1/capabilities' ? { routes: allRoutes } : { maps: [{ id: 'Europe' }] },
      ),
    );
    await expect(f.client.execute({ type: 'map', map: 'MadeUp' })).rejects.toMatchObject({
      code: 'invalid_map',
      outcome: 'failed',
    });
    expect(f.requests.every((req) => req.method === 'GET')).toBe(true);
  });

  it.each([
    { type: 'kick', steamId: '1/../../status', reason: 'x' },
    { type: 'ban', steamId: '7656119800000000', reason: 'x' },
    { type: 'broadcast', message: '' },
    { type: 'broadcast', message: 'x'.repeat(201) },
    { type: 'broadcast', message: 'text\u0000' },
    { type: 'map', map: '../config' },
    { type: 'console', message: 'restart' },
    { type: 'restart', url: 'https://other.invalid/' },
  ])('rejects invalid action input without any HTTP request: %j', async (action) => {
    const f = await fixture((_req, res) => reply(res, {}));
    await expect(f.client.execute(action as ServerAction)).rejects.toMatchObject({
      code: 'invalid_action',
      outcome: 'failed',
    });
    expect(f.requests).toHaveLength(0);
  });

  it.each([
    {},
    { ...status, players: { current: '5', max: 100 } },
    { ...status, matchSeconds: -2 },
    { ...status, players: { current: -1, max: 10 } },
  ])('rejects malformed status rather than fabricating data', async (body) => {
    const f = await fixture((_req, res) => reply(res, body));
    await expect(f.client.status()).rejects.toMatchObject({
      code: 'invalid_response',
      outcome: 'failed',
    });
  });

  it('rejects oversized player lists', async () => {
    const f = await fixture((_req, res) =>
      reply(res, {
        players: new Array(1001).fill({
          steamId,
          name: 'test',
          faction: 'RED',
          kills: 0,
          deaths: 0,
          pingMs: 1,
        }),
      }),
    );
    await expect(f.client.players()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reports a safe 429 and Retry-After without retrying or exposing upstream errors', async () => {
    const f = await fixture((_req, res) => {
      res.setHeader('Retry-After', '3');
      reply(res, { error: { message: `private error ${token}` } }, 429);
    });
    const error: unknown = await f.client.status().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RconError);
    expect(error).toMatchObject({ code: 'rate_limited', outcome: 'failed', retryAfterSeconds: 3 });
    expect(JSON.stringify(error)).not.toContain(token);
    expect(String(error)).not.toContain('private error');
    expect(f.requests).toHaveLength(1);
  });

  it('does not forward redirects or credentials to a second endpoint', async () => {
    const target = await fixture((_req, res) => reply(res, status));
    const f = await fixture((_req, res) => {
      res.writeHead(302, { Location: `${target.baseUrl}/capture` });
      res.end();
    });
    await expect(f.client.status()).rejects.toMatchObject({
      code: 'redirect_refused',
      outcome: 'failed',
    });
    expect(target.requests).toHaveLength(0);
    expect(f.requests).toHaveLength(1);
  });

  it('bounds the streamed response even without Content-Length', async () => {
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(' '.repeat(1024 * 1024 + 1));
    });
    await expect(f.client.status()).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('times out an unfinished response body', async () => {
    const f = await fixture((_req, res) => {
      res.writeHead(200);
      res.write('{');
    });
    const client = new WardogsClient({
      baseUrl: f.baseUrl,
      token,
      timeoutMs: 40,
      allowInsecureLoopback: true,
    });
    await expect(client.status()).rejects.toMatchObject({ code: 'timeout', outcome: 'failed' });
    expect(f.requests).toHaveLength(1);
  });

  it('marks a dropped mutation response unknown and never retries the action', async () => {
    const f = await fixture((req, res, raw) => {
      if (req.path === '/v1/capabilities') return reply(res, { routes: allRoutes });
      raw.socket.destroy();
    });
    await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
      code: 'transport_error',
      outcome: 'unknown',
    });
    expect(f.requests.filter((req) => req.path === '/v1/match/restart')).toHaveLength(1);
  });

  it('distinguishes known HTTP write rejection from ambiguous HTTP server error', async () => {
    for (const [statusCode, outcome] of [
      [403, 'failed'],
      [503, 'unknown'],
    ] as const) {
      const f = await fixture((req, res) =>
        req.path === '/v1/capabilities'
          ? reply(res, { routes: allRoutes })
          : reply(res, { error: { message: token } }, statusCode),
      );
      await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
        code: 'http_error',
        outcome,
      });
      expect(f.requests).toHaveLength(2);
    }
  });

  it('marks malformed mutation success unknown', async () => {
    const f = await fixture((req, res) => {
      if (req.path === '/v1/capabilities') return reply(res, { routes: allRoutes });
      res.writeHead(200);
      res.end('not json');
    });
    await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
      code: 'invalid_response',
      outcome: 'unknown',
    });
  });

  it.each([undefined, { message: 'Queued' }])(
    'does not mistake an asynchronous 202 acknowledgement for completed execution',
    async (body) => {
      const f = await fixture((req, res) => {
        if (req.path === '/v1/capabilities') return reply(res, { routes: allRoutes });
        if (body !== undefined) return reply(res, body, 202);
        res.writeHead(202);
        res.end();
      });
      await expect(f.client.execute({ type: 'restart' })).rejects.toMatchObject({
        code: 'accepted_unverified',
        outcome: 'unknown',
      });
      expect(f.requests.filter((req) => req.path === '/v1/match/restart')).toHaveLength(1);
    },
  );
});

describe('Wardogs configuration boundaries', () => {
  it.each([
    'http://example.invalid',
    'http://127.0.0.1',
    'https://user:pass@example.invalid',
    'https://example.invalid/private',
    'https://example.invalid?token=x',
    'https://example.invalid/#x',
    'file:///secret',
    'not a url',
  ])('rejects unsafe base URL %s', (baseUrl) => {
    expect(() => new WardogsClient({ baseUrl, token })).toThrow(RconError);
  });
  it.each(['http://localhost:7776', 'http://127.0.0.2:7776', 'http://127.0.0.1.evil.invalid:7776'])(
    'insecure opt-in does not authorize %s',
    (baseUrl) => {
      expect(() => new WardogsClient({ baseUrl, token, allowInsecureLoopback: true })).toThrow(
        RconError,
      );
    },
  );
  it.each([0, -1, 10001, Number.NaN])('rejects invalid timeout %s', (timeoutMs) => {
    expect(
      () => new WardogsClient({ baseUrl: 'https://example.invalid', token, timeoutMs }),
    ).toThrow(RconError);
  });
  it.each(['', 'token\r\nInjected: yes'])(
    'rejects an invalid secret without echoing it',
    (secret) => {
      expect(
        () => new WardogsClient({ baseUrl: 'https://example.invalid', token: secret }),
      ).toThrow('Invalid RCON configuration.');
    },
  );
});
