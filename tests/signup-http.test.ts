import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { WebsiteClient } from '../src/website/client.js';
import { handleSignup } from '../src/signup/handler.js';
import type { InteractionInput, InteractionPort, Response } from '../src/discord/handler.js';
import {
  signupCommandSchema,
  signupRequestSchema,
  type SignupResult,
} from '../src/signup/contracts.js';

const publicationId = '51f23b67-655e-438c-a86e-5096edb7ae01';
const matchId = 'a6c1e842-3edc-4d6c-851f-a2e94466d04c';
const actor = { guildId: '111111111111111111', userId: '222222222222222222' };
const keys = {
  publications: { keyId: 'test-publication', secret: 'p'.repeat(32) },
  signup: { keyId: 'test-signup', secret: 's'.repeat(32) },
};
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
async function fixture(mode: 'committed' | 'lost-response' | 'stale-binding' | 'locked') {
  const observations = {
    signed: 0,
    context: 0,
    writes: 0,
    commits: 0,
    nonces: new Set<string>(),
    bodies: [] as string[],
  };
  const receipts = new Map<string, SignupResult>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const nonce = String(req.headers['x-valkyria-nonce']);
    const canonical = [
      String(req.headers['x-valkyria-version']),
      String(req.headers['x-valkyria-purpose']),
      req.method,
      req.url,
      String(req.headers['x-valkyria-key-id']),
      String(req.headers['x-valkyria-timestamp']),
      nonce,
      body,
    ].join('\n');
    const expected = createHmac('sha256', keys.signup.secret).update(canonical).digest();
    const supplied = Buffer.from(String(req.headers['x-valkyria-signature']), 'hex');
    if (
      req.headers['x-valkyria-purpose'] !== 'signup' ||
      req.headers['x-valkyria-key-id'] !== keys.signup.keyId ||
      observations.nonces.has(nonce) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      res.writeHead(401);
      res.end();
      return;
    }
    observations.signed++;
    observations.nonces.add(nonce);
    const parsed: unknown = JSON.parse(body);
    let response: unknown;
    if (req.url === '/api/integrations/discord/v1/signup/context') {
      observations.context++;
      const request = signupRequestSchema.parse(parsed);
      response =
        mode === 'stale-binding'
          ? {
              schemaVersion: 1,
              request,
              state: 'obsolete',
              matchId: null,
              revision: null,
              signup: null,
              participation: null,
            }
          : {
              schemaVersion: 1,
              request,
              state: 'ready',
              matchId,
              revision: '1',
              signup: 'open',
              participation: 'none',
            };
    } else if (req.url === '/api/integrations/discord/v1/signup/participation') {
      observations.writes++;
      observations.bodies.push(body);
      const command = signupCommandSchema.parse(parsed);
      if (mode === 'locked')
        response = { schemaVersion: 1, command, status: 'rejected', reason: 'locked' };
      else {
        if (!receipts.has(command.idempotencyKey)) {
          observations.commits++;
          receipts.set(command.idempotencyKey, {
            schemaVersion: 1,
            command,
            status: 'committed',
            participation: 'waitlisted',
            revision: '2',
            committedAt: new Date().toISOString(),
          });
        }
        response = receipts.get(command.idempotencyKey);
        if (mode === 'lost-response') {
          res.destroy();
          return;
        }
      }
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('fixture');
  stops.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const client = new WebsiteClient(
    { origin: `http://127.0.0.1:${addr.port}`, keys },
    { allowLoopbackHttp: true },
  );
  const makePort = (locale: 'cs' | 'en') => {
    const replies: Response[] = [];
    const input = {
      kind: 'button',
      id: '333333333333333333',
      ...actor,
      sourceChannelId: '444444444444444444',
      sourceMessageId: '555555555555555555',
      customId: `vlk:signup:join:${publicationId}:${locale}`,
    } as InteractionInput;
    const port: InteractionPort = {
      input,
      deferReply: async ({ flags }) => {
        expect(flags).toBe(MessageFlags.Ephemeral);
      },
      editReply: async (response) => {
        replies.push(response);
      },
      clearSourceComponents: async () => {
        throw Error('must not clear shared message');
      },
    };
    return { port, replies };
  };
  const deps = {
    guildId: actor.guildId,
    defaultLocale: 'cs' as const,
    websiteOrigin: 'https://valkyriawdg.cz',
    website: client,
    membership: {
      fetch: async () => ({
        ...actor,
        roleIds: ['666666666666666666'],
        state: 'present' as const,
        observedAt: new Date().toISOString(),
      }),
    },
  };
  return { observations, deps, makePort };
}

describe('real interaction-handler to signed website HTTP fixture', () => {
  it('delivers a committed waiting-list result in Czech and sends no role names or auth secrets in reply', async () => {
    const f = await fixture('committed');
    const p = f.makePort('cs');
    await handleSignup(p.port, f.deps);
    expect(f.observations).toMatchObject({ context: 1, writes: 1, commits: 1, signed: 2 });
    expect(p.replies[0]!.content).toContain('čekací listinu');
    expect(JSON.stringify(p.replies)).not.toContain(keys.signup.secret);
    expect(JSON.stringify(p.replies)).not.toContain(actor.userId);
  });
  it('concurrent same-interaction deliveries share one canonical fixture receipt and use fresh nonces', async () => {
    const f = await fixture('committed');
    const a = f.makePort('en');
    const b = f.makePort('en');
    await Promise.all([handleSignup(a.port, f.deps), handleSignup(b.port, f.deps)]);
    expect(f.observations).toMatchObject({ writes: 2, commits: 1, signed: 4 });
    expect(f.observations.nonces.size).toBe(4);
    expect(f.observations.bodies[0]).toBe(f.observations.bodies[1]);
    expect(a.replies[0]!.content).toContain('waiting list');
    expect(b.replies[0]!.content).toContain('waiting list');
  });
  it('a committed fixture write with a lost response stays unknown without HTTP retry', async () => {
    const f = await fixture('lost-response');
    const p = f.makePort('en');
    await handleSignup(p.port, f.deps);
    expect(f.observations).toMatchObject({ writes: 1, commits: 1 });
    expect(p.replies[0]!.content).toContain('unknown');
  });
  it('a website lock applied after preflight yields rejection, not a signup', async () => {
    const f = await fixture('locked');
    const p = f.makePort('en');
    await handleSignup(p.port, f.deps);
    expect(f.observations).toMatchObject({ writes: 1, commits: 0 });
    expect(p.replies[0]!.content).toContain('locked');
  });
  it('an obsolete canonical source message stops before sending any mutation', async () => {
    const f = await fixture('stale-binding');
    const p = f.makePort('cs');
    await handleSignup(p.port, f.deps);
    expect(f.observations).toMatchObject({ context: 1, writes: 0, commits: 0 });
    expect(p.replies[0]!.content).toContain('aktuální');
  });
});
