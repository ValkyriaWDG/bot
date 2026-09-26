import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebsiteClient } from '../src/website/client.js';

const keys = {
  publications: { keyId: 'publication-test', secret: 'p'.repeat(32) },
  signup: { keyId: 'signup-test', secret: 's'.repeat(32) },
};
const matchId = 'a6c1e842-3edc-4d6c-851f-a2e94466d04c';
const publicationId = '51f23b67-655e-438c-a86e-5096edb7ae01';
const request = {
  schemaVersion: 1 as const,
  publicationId,
  locale: 'cs' as const,
  guildId: '111111111111111111',
  userId: '222222222222222222',
  interactionId: '333333333333333333',
  channelId: '444444444444444444',
  messageId: '555555555555555555',
};
const command = {
  ...request,
  action: 'join' as const,
  expectedRevision: '4',
  idempotencyKey: `${request.guildId}:${request.userId}:${request.interactionId}`,
};
const projection = {
  schemaVersion: 1,
  publicationId,
  matchId,
  revision: '4',
  locale: 'cs',
  publication: 'withdrawn',
};
const stops: (() => Promise<void>)[] = [];
const actualFetch = globalThis.fetch;
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!['127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('test_non_loopback_refused');
    return actualFetch(input, init);
  });
});
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  vi.restoreAllMocks();
});
async function fixture(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  const seen: {
    path: string;
    body: string;
    headers: IncomingMessage['headers'];
    method: string;
  }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ path: req.url!, body, headers: req.headers, method: req.method! });
    handler(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  stops.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const origin = `http://127.0.0.1:${address.port}`;
  const client = new WebsiteClient(
    { origin, keys, timeoutMs: 1000 },
    {
      allowLoopbackHttp: true,
      now: () => new Date('2026-09-26T12:00:00Z'),
      nonce: () => 'ab'.repeat(16),
    },
  );
  return { client, origin, seen };
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function committed() {
  return {
    schemaVersion: 1,
    command,
    status: 'committed',
    participation: 'joined',
    revision: '5',
    committedAt: '2026-09-26T12:00:00Z',
  };
}

describe('bounded purpose-authenticated website client', () => {
  it('keeps canonical HTTPS links while routing explicit fixture traffic only to literal loopback', async () => {
    const published = {
      ...projection,
      publication: 'published',
      status: 'scheduled',
      startsAt: '2026-10-01T18:00:00Z',
      timeZone: 'Europe/Prague',
      publicUrl: 'https://website.example.invalid/cs/matches/example',
      game: 'Wardogs',
      opponent: 'Example',
      competition: 'Fixture',
      signup: 'open',
      result: null,
    };
    const f = await fixture((_req, res) => json(res, published));
    const client = new WebsiteClient(
      { origin: 'https://website.example.invalid', keys },
      { allowLoopbackHttp: true, loopbackOrigin: f.origin },
    );
    expect(await client.latest(matchId, 'cs')).toEqual(published);
    expect(
      () =>
        new WebsiteClient(
          { origin: 'https://website.example.invalid', keys },
          { loopbackOrigin: f.origin },
        ),
    ).toThrow('website_configuration');
    expect(
      () =>
        new WebsiteClient(
          { origin: 'https://website.example.invalid', keys },
          { allowLoopbackHttp: true, loopbackOrigin: 'https://evil.example' },
        ),
    ).toThrow('website_configuration');
  });
  it('signs exact method, query, purpose, key and raw bytes on real HTTP requests', async () => {
    const f = await fixture((_req, res) =>
      json(res, { schemaVersion: 1, events: [], nextCursor: '9' }),
    );
    expect(await f.client.events('9')).toEqual({ schemaVersion: 1, events: [], nextCursor: '9' });
    const sent = f.seen[0]!;
    const message = [
      '1',
      'publications',
      'GET',
      '/api/integrations/discord/v1/publication-events?after=9',
      keys.publications.keyId,
      '1790424000',
      'ab'.repeat(16),
      '',
    ].join('\n');
    expect(sent.path).toBe('/api/integrations/discord/v1/publication-events?after=9');
    expect(sent.headers['x-valkyria-purpose']).toBe('publications');
    expect(sent.headers['x-valkyria-signature']).toBe(
      createHmac('sha256', keys.publications.secret).update(message).digest('hex'),
    );
    expect(sent.headers['x-valkyria-version']).toBe('1');
  });
  it('uses the separate signup key and preserves exact committed result', async () => {
    const f = await fixture((_req, res) => json(res, committed()));
    expect(await f.client.participate(command)).toEqual(committed());
    const sent = f.seen[0]!;
    expect(sent.body).toBe(JSON.stringify(command));
    expect(sent.headers['x-valkyria-key-id']).toBe(keys.signup.keyId);
    expect(sent.headers['x-valkyria-purpose']).toBe('signup');
    const signature = createHmac('sha256', keys.signup.secret)
      .update(
        [
          '1',
          'signup',
          'POST',
          sent.path,
          keys.signup.keyId,
          sent.headers['x-valkyria-timestamp'],
          sent.headers['x-valkyria-nonce'],
          sent.body,
        ].join('\n'),
      )
      .digest('hex');
    expect(sent.headers['x-valkyria-signature']).toBe(signature);
  });
  it('parses canonical context and rejects a response for another actor', async () => {
    let wrong = false;
    const f = await fixture((_req, res) =>
      json(res, {
        schemaVersion: 1,
        request: wrong ? { ...request, userId: '999999999999999999' } : request,
        state: 'ready',
        matchId,
        revision: '4',
        signup: 'open',
        participation: 'none',
      }),
    );
    expect((await f.client.context(request)).state).toBe('ready');
    wrong = true;
    await expect(f.client.context(request)).rejects.toMatchObject({ code: 'website_unavailable' });
  });
  it('accepts only an exact binding acknowledgement', async () => {
    const binding = {
      schemaVersion: 1 as const,
      publicationId,
      matchId,
      revision: '4',
      guildId: request.guildId,
      channelId: request.channelId,
      messageId: request.messageId,
      locale: 'cs' as const,
    };
    let wrong = false;
    const f = await fixture((_req, res) =>
      json(res, {
        schemaVersion: 1,
        status: 'bound',
        binding: wrong ? { ...binding, messageId: request.userId } : binding,
      }),
    );
    await expect(f.client.bindPublication(binding)).resolves.toBeUndefined();
    wrong = true;
    await expect(f.client.bindPublication(binding)).rejects.toMatchObject({
      code: 'website_unknown',
    });
  });
  it('validates projection identity and rejects draft or unexpected fields', async () => {
    let value: unknown = projection;
    const f = await fixture((_req, res) => json(res, value));
    expect(await f.client.latest(matchId, 'cs')).toEqual(projection);
    value = { ...projection, locale: 'en' };
    await expect(f.client.latest(matchId, 'cs')).rejects.toThrow('website_unavailable');
    value = { ...projection, draftTitle: 'private' };
    await expect(f.client.latest(matchId, 'cs')).rejects.toThrow('website_unavailable');
  });
  it('rejects oversized pages and nonadvancing cursors with events', async () => {
    const event = {
      schemaVersion: 1,
      eventId: 'c19ac4b4-459e-4341-bfef-a659352eeb8d',
      guildId: request.guildId,
      projection,
    };
    let value: unknown = { schemaVersion: 1, events: [event], nextCursor: '9' };
    const f = await fixture((_req, res) => json(res, value));
    await expect(f.client.events('9')).rejects.toThrow('website_unavailable');
    value = { schemaVersion: 1, events: Array.from({ length: 51 }, () => event), nextCursor: '10' };
    await expect(f.client.events('9')).rejects.toThrow('website_unavailable');
    value = { schemaVersion: 1, events: [], nextCursor: '8' };
    await expect(f.client.events('9')).rejects.toThrow('website_unavailable');
  });
  it.each([202, 302, 429, 500])(
    'does not retry or follow redirect after mutation HTTP %s',
    async (status) => {
      const f = await fixture((_req, res) => {
        res.writeHead(status, { location: 'https://example.invalid/leak' });
        res.end('secret-body');
      });
      await expect(f.client.participate(command)).rejects.toMatchObject({
        code: 'website_unknown',
      });
      expect(f.seen).toHaveLength(1);
    },
  );
  it('does not forward signed requests to another loopback origin on redirects', async () => {
    const destination = await fixture((_req, res) => json(res, committed()));
    const source = await fixture((_req, res) => {
      res.writeHead(302, { location: `${destination.origin}/leak` });
      res.end();
    });
    await expect(source.client.participate(command)).rejects.toThrow('website_unknown');
    expect(source.seen).toHaveLength(1);
    expect(destination.seen).toHaveLength(0);
  });
  it('has a finite timeout after dispatch and returns unknown exactly once', async () => {
    const f = await fixture(() => {});
    await expect(f.client.participate(command)).rejects.toThrow('website_unknown');
    expect(f.seen).toHaveLength(1);
  });
  it('bounds streamed response bytes even without content-length', async () => {
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(' '.repeat(300_000));
    });
    await expect(f.client.context(request)).rejects.toThrow('website_unavailable');
  });
  it('rejects invalid mutation echoes and never reflects provider errors or secrets', async () => {
    const f = await fixture((_req, res) =>
      json(res, { ...committed(), command: { ...command, userId: request.messageId } }),
    );
    await expect(f.client.participate(command)).rejects.toThrow('website_unknown');
  });
  it('rejects unsafe origins, reused credentials and short secrets before network IO', () => {
    for (const origin of [
      'http://example.com',
      'https://a.test/path',
      'https://user:password@a.test',
      'https://a.test/?x=1',
    ])
      expect(() => new WebsiteClient({ origin, keys })).toThrow('website_configuration');
    expect(
      () =>
        new WebsiteClient({
          origin: 'https://a.test',
          keys: { ...keys, signup: keys.publications },
        }),
    ).toThrow('website_configuration');
    expect(
      () =>
        new WebsiteClient({
          origin: 'https://a.test',
          keys: { ...keys, signup: { ...keys.signup, secret: keys.publications.secret } },
        }),
    ).toThrow('website_configuration');
    expect(
      () =>
        new WebsiteClient({
          origin: 'https://a.test',
          keys: { ...keys, signup: { ...keys.signup, secret: 'short' } },
        }),
    ).toThrow('website_configuration');
  });
  it('rejects path/query injection inputs without dispatch', async () => {
    const f = await fixture((_req, res) => json(res, projection));
    await expect(f.client.events('0&admin=true')).rejects.toThrow('website_request');
    await expect(f.client.latest('../private', 'cs')).rejects.toThrow('website_request');
    await expect(f.client.participate({ ...command, idempotencyKey: 'attacker' })).rejects.toThrow(
      'website_request',
    );
    expect(f.seen).toHaveLength(0);
  });
});
