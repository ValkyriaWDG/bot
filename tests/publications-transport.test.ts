import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { REST } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { DiscordPublicationTransport } from '../src/publications/transport.js';
import { renderMatch } from '../src/publications/render.js';
import { parseMatchProjection, publicationNonce } from '../src/publications/contracts.js';

const body = renderMatch(
  parseMatchProjection({
    schemaVersion: 1,
    matchId: 'a1111111-1111-4111-8111-111111111111',
    publicationId: 'b1111111-1111-4111-8111-111111111111',
    revision: '1',
    locale: 'cs',
    publication: 'withdrawn',
  }),
  'fixture',
  false,
)!;
describe('real Discord REST serialization against loopback HTTP', () => {
  it('surfaces an actual REST 429 with its retry delay instead of hiding a resend', async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '1',
        'x-ratelimit-reset-after': '1',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '1',
        'x-ratelimit-bucket': 'fixture-publication',
      });
      res.end(JSON.stringify({ message: 'Rate limited', retry_after: 1, global: false }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const rest = new REST({
      api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      retries: 0,
      timeout: 1000,
      rejectOnRateLimit: () => true,
    }).setToken('synthetic-fixture-token');
    try {
      await expect(
        new DiscordPublicationTransport(rest).create('222222222222222222', body, 'fixture'),
      ).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: expect.any(Number) });
      expect(calls).toBe(1);
    } finally {
      rest.clearHashSweeper();
      rest.clearHandlerSweeper();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('sends safe create/edit payloads with stable nonce and explicit attachment clearing', async () => {
    const requests: { method: string; url: string; body: Record<string, unknown> }[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({
        method: req.method!,
        url: req.url!,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: '333333333333333333' }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const rest = new REST({
      api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      version: '10',
      retries: 0,
      timeout: 1000,
      rejectOnRateLimit: () => true,
    }).setToken('synthetic-fixture-token');
    try {
      const transport = new DiscordPublicationTransport(rest);
      const nonce = publicationNonce('fixture-binding');
      const id = await transport.create('222222222222222222', body, nonce);
      await transport.edit('222222222222222222', id, body);
      expect(requests.map((r) => r.method)).toEqual(['POST', 'PATCH']);
      expect(requests[0]?.url).toBe('/v10/channels/222222222222222222/messages');
      expect(requests[0]?.body).toMatchObject({
        nonce,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
        attachments: [],
        components: [],
        embeds: [],
      });
      expect(requests[1]?.body).toEqual(body);
    } finally {
      rest.clearHashSweeper();
      rest.clearHandlerSweeper();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('maps deleted-message, forbidden and uncertain HTTP failures without hidden retries', async () => {
    for (const status of [404, 403, 500]) {
      let calls = 0;
      const server = createServer((_req, res) => {
        calls++;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            code: status === 404 ? 10008 : 50013,
            message: 'fixture private details',
          }),
        );
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const rest = new REST({
        api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        retries: 0,
        timeout: 1000,
        rejectOnRateLimit: () => true,
      }).setToken('synthetic-fixture-token');
      try {
        await expect(
          new DiscordPublicationTransport(rest).edit(
            '222222222222222222',
            '333333333333333333',
            body,
          ),
        ).rejects.toMatchObject({
          code: status === 404 ? 'deleted' : status === 403 ? 'forbidden' : 'uncertain',
        });
        expect(calls).toBe(1);
      } finally {
        rest.clearHashSweeper();
        rest.clearHandlerSweeper();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });
});
