import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { MessageFlags } from 'discord.js';
import type { Locale } from '../src/contracts.js';
import type { InteractionInput, InteractionPort, Response } from '../src/discord/handler.js';
import { DiscordMembershipProvider } from '../src/discord/membership.js';
import { migrate } from '../src/persistence/migrations.js';
import {
  publicationBindingSchema,
  type MatchProjection,
  type PublicationBinding,
  type PublicationDestination,
  type PublicationEvent,
  type PublicationPayload,
} from '../src/publications/contracts.js';
import { PublicationService } from '../src/publications/service.js';
import { PostgresPublicationStore } from '../src/publications/store.js';
import { DiscordPublicationTransport } from '../src/publications/transport.js';
import { StatusBoardPoller } from '../src/publications/status.js';
import { handleSignup } from '../src/signup/handler.js';
import {
  signupCommandSchema,
  signupRequestSchema,
  type SignupResult,
} from '../src/signup/contracts.js';
import { WebsiteClient } from '../src/website/client.js';
import { validateLabDatabase } from '../tests/lab/run.js';

export interface ExtensionsScenario {
  id: string;
  title: string;
  locale: Locale;
  status: 'passed' | 'failed';
  checks: { label: string; passed: boolean; details: string }[];
  requests: { target: 'website' | 'discord'; method: string; path: string; body: unknown }[];
  responses: Response[];
  payloads: {
    operation: 'create' | 'edit';
    channelId: string;
    messageId: string;
    body: PublicationPayload;
  }[];
  observations: Record<string, string | number | boolean>;
}
export interface ExtensionsReport {
  schemaVersion: 1;
  evidenceKind: 'simulated-discord-extensions';
  generatedAt: string;
  executionStatus: 'completed';
  revision: { sha: string; dirty: boolean };
  environment: { database: string; discord: string; website: string };
  scenarios: ExtensionsScenario[];
  summary: { total: number; passed: number; failed: number };
}
const ids = {
  guild: '111111111111111111',
  member: '222222222222222222',
  role: '333333333333333333',
  channelCs: '444444444444444444',
  channelEn: '555555555555555555',
};
const keys = {
  publications: { keyId: 'lab-publications', secret: 'test-publication-secret-'.repeat(2) },
  signup: { keyId: 'lab-signup', secret: 'test-signup-secret-'.repeat(3) },
};
const origin = 'https://valkyriawdg.cz';
type Published = Extract<MatchProjection, { publication: 'published' }>;

export async function runExtensionsLab(databaseUrl: string): Promise<ExtensionsReport> {
  validateLabDatabase(databaseUrl);
  const schema = `extensions_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`,
    max: 6,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  let created = false;
  let server: Server | undefined;
  const report: ExtensionsReport = {
    schemaVersion: 1,
    evidenceKind: 'simulated-discord-extensions',
    generatedAt: new Date().toISOString(),
    executionStatus: 'completed',
    revision: {
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    },
    environment: {
      database: 'Real dedicated PostgreSQL; isolated random schema',
      discord:
        'Production publication transport over loopback HTTP; signup InteractionPort records private replies, no Gateway or native Discord UI',
      website:
        'Production WebsiteClient against independent loopback HMAC fixture; not the separately developed website or its database',
    },
    scenarios: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await migrate(pool);
    const store = new PostgresPublicationStore(pool, ids.guild);
    const projections = new Map<string, MatchProjection>();
    const bindings = new Map<string, PublicationBinding>();
    const participations = new Map<string, 'none' | 'joined' | 'waitlisted' | 'withdrawn'>();
    const receipts = new Map<string, SignupResult>();
    const discordMessages = new Map<string, PublicationPayload>();
    const seenNonces = new Set<string>();
    let nextMessage = 700000000000000000n;
    let nextInteraction = 800000000000000000n;
    let current: ExtensionsScenario;
    let mode: 'normal' | 'waitlist' | 'unlinked' | 'lost-response' | 'revoked' = 'normal';
    let membershipReads = 0;
    let writes = 0;
    let commits = 0;
    let currentTime = new Date();
    const keyFor = (matchId: string, locale: string) => `${matchId}:${locale}`;
    const check = (label: string, passed: boolean, details: string) =>
      current.checks.push({ label, passed, details });
    const saveRequest = (
      target: 'website' | 'discord',
      method: string,
      path: string,
      body: unknown,
    ) => {
      current.requests.push({ target, method, path, body });
    };
    server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString('utf8');
        const body: unknown = raw ? JSON.parse(raw) : null;
        const path = req.url!;
        const method = req.method!;
        const send = (value: unknown, status = 200) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        if (path.startsWith('/api/integrations/discord/v1/')) {
          const purpose = req.headers['x-valkyria-purpose'];
          if (purpose !== 'publications' && purpose !== 'signup') {
            send({ error: 'purpose' }, 401);
            return;
          }
          const key = keys[purpose];
          const nonce = String(req.headers['x-valkyria-nonce']);
          const timestamp = String(req.headers['x-valkyria-timestamp']);
          const expected = createHmac('sha256', key.secret)
            .update(['1', purpose, method, path, key.keyId, timestamp, nonce, raw].join('\n'))
            .digest();
          const received = Buffer.from(String(req.headers['x-valkyria-signature']), 'hex');
          const isSignupRoute = path.startsWith('/api/integrations/discord/v1/signup/');
          if (
            req.headers['x-valkyria-version'] !== '1' ||
            req.headers['x-valkyria-key-id'] !== key.keyId ||
            isSignupRoute !== (purpose === 'signup') ||
            Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
            !/^[a-f0-9]{32}$/.test(nonce) ||
            seenNonces.has(nonce) ||
            received.length !== expected.length ||
            !timingSafeEqual(received, expected)
          ) {
            send({ error: 'authentication' }, 401);
            return;
          }
          seenNonces.add(nonce);
          saveRequest('website', method, path, body);
          const latest =
            /^\/api\/integrations\/discord\/v1\/matches\/([a-f0-9-]+)\/publication\/(cs|en)$/.exec(
              path,
            );
          if (method === 'GET' && latest) {
            const projection = projections.get(keyFor(latest[1]!, latest[2]!));
            send(projection ?? {}, projection ? 200 : 404);
            return;
          }
          if (method === 'POST' && path.endsWith('/publication-bindings')) {
            const binding = publicationBindingSchema.parse(body);
            const projection = projections.get(keyFor(binding.matchId, binding.locale));
            if (
              !projection ||
              projection.publication !== 'published' ||
              projection.publicationId !== binding.publicationId ||
              projection.revision !== binding.revision ||
              binding.guildId !== ids.guild ||
              !discordMessages.has(binding.messageId)
            ) {
              send({ error: 'binding' }, 409);
              return;
            }
            bindings.set(binding.publicationId, binding);
            send({ schemaVersion: 1, status: 'bound', binding });
            return;
          }
          if (method === 'POST' && path.endsWith('/signup/context')) {
            const request = signupRequestSchema.parse(body);
            const binding = bindings.get(request.publicationId);
            const valid =
              binding &&
              binding.guildId === request.guildId &&
              binding.channelId === request.channelId &&
              binding.messageId === request.messageId &&
              binding.locale === request.locale &&
              projections.get(keyFor(binding.matchId, binding.locale))?.publication === 'published';
            const state = !valid ? 'obsolete' : mode === 'unlinked' ? 'unlinked' : 'ready';
            send(
              state === 'ready'
                ? {
                    schemaVersion: 1,
                    request,
                    state,
                    matchId: binding!.matchId,
                    revision: '1',
                    signup: 'open',
                    participation:
                      participations.get(`${request.publicationId}:${request.userId}`) ?? 'none',
                  }
                : {
                    schemaVersion: 1,
                    request,
                    state,
                    matchId: null,
                    revision: null,
                    signup: null,
                    participation: null,
                  },
            );
            return;
          }
          if (method === 'POST' && path.endsWith('/signup/participation')) {
            const command = signupCommandSchema.parse(body);
            writes++;
            const binding = bindings.get(command.publicationId);
            if (
              !binding ||
              binding.guildId !== command.guildId ||
              binding.channelId !== command.channelId ||
              binding.messageId !== command.messageId
            ) {
              send({ schemaVersion: 1, command, status: 'rejected', reason: 'obsolete' });
              return;
            }
            if (!receipts.has(command.idempotencyKey)) {
              const participation =
                command.action === 'withdraw'
                  ? 'withdrawn'
                  : mode === 'waitlist'
                    ? 'waitlisted'
                    : 'joined';
              participations.set(`${command.publicationId}:${command.userId}`, participation);
              commits++;
              receipts.set(command.idempotencyKey, {
                schemaVersion: 1,
                command,
                status: 'committed',
                participation,
                revision: '2',
                committedAt: new Date().toISOString(),
              });
            }
            if (mode === 'lost-response') {
              res.destroy();
              return;
            }
            send(receipts.get(command.idempotencyKey));
            return;
          }
          send({ error: 'route' }, 404);
          return;
        }
        if (method === 'GET' && path === `/guilds/${ids.guild}/members/${ids.member}`) {
          saveRequest('discord', method, path, null);
          membershipReads++;
          if (mode === 'revoked' && membershipReads >= 2) {
            send({ code: 10007 }, 404);
            return;
          }
          send({ user: { id: ids.member }, roles: [ids.role] });
          return;
        }
        const discordRoute = /^\/channels\/([1-9][0-9]+)\/messages(?:\/([1-9][0-9]+))?$/.exec(path);
        if (discordRoute && (method === 'POST' || method === 'PATCH')) {
          const value = body as PublicationPayload & { nonce?: string; enforce_nonce?: boolean };
          const payload: PublicationPayload = {
            content: value.content,
            embeds: value.embeds,
            components: value.components,
            attachments: value.attachments,
            allowed_mentions: value.allowed_mentions,
          };
          const messageId = method === 'POST' ? String(++nextMessage) : discordRoute[2]!;
          if (method === 'PATCH' && !discordMessages.has(messageId)) {
            send({ code: 10008 }, 404);
            return;
          }
          discordMessages.set(messageId, payload);
          saveRequest('discord', method, path, payload);
          current.payloads.push({
            operation: method === 'POST' ? 'create' : 'edit',
            channelId: discordRoute[1]!,
            messageId,
            body: payload,
          });
          send({ id: messageId });
          return;
        }
        send({ error: 'route' }, 404);
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('LAB_FIXTURE_START');
    const loopback = `http://127.0.0.1:${address.port}`;
    async function discordRequest(
      method: string,
      route: string,
      body?: unknown,
      signal?: AbortSignal,
    ) {
      const response = await fetch(`${loopback}${route}`, {
        method,
        ...(signal ? { signal } : {}),
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json();
      if (!response.ok) throw { status: response.status, ...(value as object) };
      return value;
    }
    const transport = new DiscordPublicationTransport({
      post: (route, options) => discordRequest('POST', route, options.body, options.signal),
      patch: (route, options) => discordRequest('PATCH', route, options.body, options.signal),
    });
    const memberProvider = new DiscordMembershipProvider(
      { get: (route) => discordRequest('GET', route) },
      ids.guild,
    );
    const website = new WebsiteClient(
      { origin, keys },
      { allowLoopbackHttp: true, loopbackOrigin: loopback },
    );
    const destination = (
      locale: Locale,
      purpose: PublicationDestination['purpose'],
    ): PublicationDestination => ({
      guildId: ids.guild,
      channelId: locale === 'cs' ? ids.channelCs : ids.channelEn,
      locale,
      purpose,
    });
    const service = (dest: PublicationDestination) =>
      new PublicationService({
        store,
        transport,
        source: website,
        destinations: [dest],
        enabled: true,
        signupEnabled: true,
        websiteOrigin: origin,
        now: () => currentTime,
        authorizeDestination: async (d) =>
          d.guildId === ids.guild && [ids.channelCs, ids.channelEn].includes(d.channelId),
      });
    const projection = (locale: Locale): Published => ({
      schemaVersion: 1,
      matchId: randomUUID(),
      publicationId: randomUUID(),
      revision: '1',
      locale,
      publication: 'published',
      status: 'scheduled',
      startsAt: '2026-10-01T18:00:00Z',
      timeZone: 'Europe/Prague',
      publicUrl: `${origin}/${locale}/matches/synthetic-fixture`,
      game: 'Wardogs',
      opponent: 'SYNTHETIC Rival Squad',
      competition: locale === 'cs' ? 'Ukázkový přátelský zápas' : 'Synthetic friendly fixture',
      signup: 'open',
      result: null,
    });
    const event = (p: MatchProjection): PublicationEvent => ({
      schemaVersion: 1,
      eventId: randomUUID(),
      guildId: ids.guild,
      projection: p,
    });
    async function drain(worker: PublicationService) {
      for (let i = 0; i < 8; i++) {
        currentTime = new Date(Math.max(Date.now(), currentTime.getTime()) + 2);
        await worker.tick();
      }
    }
    async function scenario(id: string, title: string, locale: Locale, work: () => Promise<void>) {
      current = {
        id,
        title,
        locale,
        status: 'passed',
        checks: [],
        requests: [],
        responses: [],
        payloads: [],
        observations: {},
      };
      report.scenarios.push(current);
      mode = 'normal';
      membershipReads = 0;
      try {
        await work();
      } catch {
        check(
          'Scenario completed without exception',
          false,
          'Unexpected local test failure; inspect the focused test.',
        );
      }
      current.status =
        current.checks.length && current.checks.every((c) => c.passed) ? 'passed' : 'failed';
    }
    const fixtures = new Map<Locale, Published>();
    for (const locale of ['cs', 'en'] as const) {
      await scenario(
        `fixture-${locale}`,
        `Published match and bound signup controls (${locale.toUpperCase()})`,
        locale,
        async () => {
          const p = projection(locale);
          fixtures.set(locale, p);
          projections.set(keyFor(p.matchId, locale), p);
          const worker = service(destination(locale, 'fixture'));
          await worker.accept(event(p));
          await drain(worker);
          const rows = await pool.query<{ state: string; message_id: string }>(
            'SELECT state,message_id FROM publication_bindings WHERE entity_id=$1 AND locale=$2',
            [p.matchId, locale],
          );
          check(
            'Durable message binding delivered',
            rows.rows[0]?.state === 'delivered',
            'Actual publication_bindings row after HTTP delivery.',
          );
          check(
            'Create without active controls, then exact binding acknowledgement',
            current.payloads[0]?.operation === 'create' &&
              current.payloads[0]?.body.components.length === 0 &&
              bindings.get(p.publicationId)?.messageId === rows.rows[0]?.message_id,
            'Website fixture accepted the actual Discord message ID.',
          );
          check(
            'Three localized signup controls after acknowledgement',
            JSON.stringify(
              current.payloads.at(-1)?.body.components[0]?.components.map((c) => c.label),
            ) ===
              JSON.stringify(
                locale === 'cs'
                  ? ['Přihlásit se', 'Odhlásit se', 'Moje účast']
                  : ['Join', 'Withdraw', 'My participation'],
              ),
            'Captured HTTP PATCH body from production renderer.',
          );
          current.observations.creates = current.payloads.filter(
            (p) => p.operation === 'create',
          ).length;
        },
      );
      await scenario(
        `result-${locale}`,
        `Verified result and same-message correction (${locale.toUpperCase()})`,
        locale,
        async () => {
          const p: Published = {
            ...projection(locale),
            status: 'completed',
            signup: 'closed',
            result: { homeScore: 3, awayScore: 2, verified: true, outcome: 'win' },
          };
          projections.set(keyFor(p.matchId, locale), p);
          const worker = service(destination(locale, 'result'));
          await worker.accept(event(p));
          await drain(worker);
          const updated: Published = {
            ...p,
            revision: '2',
            result: { homeScore: 4, awayScore: 2, verified: true, outcome: 'win' },
          };
          projections.set(keyFor(p.matchId, locale), updated);
          await worker.accept(event(updated));
          await drain(worker);
          check(
            'Corrected score sent by actual renderer',
            current.payloads.at(-1)?.body.embeds[0]?.title.includes('4 : 2') === true &&
              current.payloads
                .at(-1)
                ?.body.embeds[0]?.title.startsWith(
                  locale === 'cs' ? 'Aktualizovaný výsledek' : 'Updated result',
                ) === true,
            'Correction follows a newly verified canonical revision.',
          );
          check(
            'Correction edits one durable message',
            current.payloads.filter((p) => p.operation === 'create').length === 1 &&
              new Set(current.payloads.map((p) => p.messageId)).size === 1,
            'Recorded one create and a later edit, no duplicate result post.',
          );
          const corrected = await pool.query<{ state: string; delivered_revision: string }>(
            'SELECT state,delivered_revision FROM publication_bindings WHERE entity_id=$1 AND locale=$2',
            [p.matchId, locale],
          );
          check(
            'Corrected revision durably delivered',
            corrected.rows[0]?.state === 'delivered' &&
              corrected.rows[0]?.delivered_revision === '2',
            'Actual PostgreSQL row records delivered revision 2.',
          );
        },
      );
    }
    async function signup(locale: Locale, action: 'join' | 'withdraw' | 'mine') {
      const p = fixtures.get(locale)!;
      const binding = bindings.get(p.publicationId)!;
      const input: InteractionInput = {
        kind: 'button',
        id: String(++nextInteraction),
        guildId: ids.guild,
        userId: ids.member,
        customId: `vlk:signup:${action}:${p.publicationId}:${locale}`,
        sourceChannelId: binding.channelId,
        sourceMessageId: binding.messageId,
      };
      let deferred = false;
      const port: InteractionPort = {
        input,
        deferReply: async ({ flags }) => {
          deferred = flags === MessageFlags.Ephemeral;
        },
        editReply: async (response) => {
          current.responses.push(response);
        },
        clearSourceComponents: async () => {
          throw Error('shared_controls');
        },
      };
      await handleSignup(port, {
        guildId: ids.guild,
        defaultLocale: 'cs',
        websiteOrigin: origin,
        membership: memberProvider,
        website,
      });
      check(
        'Private acknowledgement and suppressed mentions',
        deferred && current.responses.at(-1)?.allowedMentions.parse.length === 0,
        'Actual handler response captured at InteractionPort.',
      );
      return current.responses.at(-1)?.content ?? '';
    }
    await scenario('signup-join-cs', 'Authoritative website signup (CS)', 'cs', async () => {
      const before = commits;
      const text = await signup('cs', 'join');
      check(
        'Website committed once; handler confirmed signup',
        commits === before + 1 && text.includes('přihlášení'),
        'Real signed HTTP request to synthetic website transaction fixture.',
      );
    });
    await scenario(
      'signup-waitlist-en',
      'Waiting list is not a roster slot (EN)',
      'en',
      async () => {
        mode = 'waitlist';
        const text = await signup('en', 'join');
        check(
          'Explicit waiting-list outcome',
          text.includes('waiting list') && text.includes('not been assigned'),
          'Website committed waitlisted; bot did not invent a guaranteed slot.',
        );
      },
    );
    await scenario('signup-withdraw-cs', 'Authoritative withdrawal (CS)', 'cs', async () => {
      const before = commits;
      const text = await signup('cs', 'withdraw');
      check(
        'One committed withdrawal',
        commits === before + 1 && text.includes('odhlášení'),
        'Website receipt, not a local roster update.',
      );
    });
    await scenario('signup-mine-en', 'Private participation lookup (EN)', 'en', async () => {
      const before = writes;
      const text = await signup('en', 'mine');
      check(
        'Reads current waiting-list state without a write',
        writes === before && text.includes('waiting list'),
        'Context route only; participation mutation count unchanged.',
      );
    });
    await scenario('signup-unlinked-cs', 'Safe website account handoff (CS)', 'cs', async () => {
      mode = 'unlinked';
      const before = writes;
      const text = await signup('cs', 'join');
      check(
        'Unlinked account requires canonical website login',
        writes === before && text.includes(`${origin}/cs/account`),
        'No local user/admin provisioning or redirect from response data.',
      );
    });
    await scenario(
      'signup-revoked-en',
      'Membership revoked after preflight (EN)',
      'en',
      async () => {
        mode = 'revoked';
        const before = writes;
        const text = await signup('en', 'join');
        check(
          'Second fresh Discord REST lookup denies write',
          membershipReads === 2 && writes === before && text.includes('cannot be verified'),
          'Member disappeared between context and final dispatch.',
        );
      },
    );
    await scenario(
      'signup-unknown-en',
      'Website committed but response lost (EN)',
      'en',
      async () => {
        mode = 'lost-response';
        const before = commits;
        const beforeWrites = writes;
        const text = await signup('en', 'join');
        check(
          'Lost response remains unknown without retry',
          commits === before + 1 && writes === beforeWrites + 1 && text.includes('unknown'),
          'Fixture committed, closed socket, and observed exactly one mutation request.',
        );
      },
    );
    for (const locale of ['cs', 'en'] as const) {
      const stale = locale === 'cs';
      await scenario(
        stale ? 'status-stale-cs' : 'status-unknown-en',
        stale
          ? 'Expired server observation is STALE (CS)'
          : 'Unavailable server with no observation is UNKNOWN (EN)',
        locale,
        async () => {
          const dest = destination(locale, 'status');
          let available = stale;
          const poller = new StatusBoardPoller({
            store,
            boards: [
              {
                serverId: stale ? 'stale' : 'unknown',
                label: 'SYNTHETIC Valkyria Server',
                destination: dest,
                pollSeconds: 30,
                freshForSeconds: 60,
              },
            ],
            enabled: true,
            now: () => currentTime,
            readStatus: async () => {
              if (!available) throw Error('fixture_unavailable');
              return {
                serverName: 'SYNTHETIC',
                map: 'SYNTHETIC MAP',
                playerCount: 12,
                maxPlayers: 100,
                matchSeconds: 900,
              };
            },
          });
          const worker = service(dest);
          await poller.tick();
          await drain(worker);
          if (stale) {
            available = false;
            currentTime = new Date(currentTime.getTime() + 61_000);
            await poller.tick();
            await drain(worker);
          }
          const latest = current.payloads.at(-1)?.body;
          check(
            'Truthful state in rendered status message',
            latest?.embeds[0]?.title.includes(stale ? 'STALE' : 'UNKNOWN') === true,
            'Production StatusBoardPoller/store/service/renderer with synthetic read failure.',
          );
          check(
            'Unknown does not fabricate an empty server',
            stale || latest?.embeds[0]?.fields?.length === 0,
            'No zero-player claim without a sample.',
          );
        },
      );
    }
    await scenario(
      'publication-withdrawn-cs',
      'Retracted publication removes old content and controls (CS)',
      'cs',
      async () => {
        const p = fixtures.get('cs')!;
        const withdrawn: MatchProjection = {
          schemaVersion: 1,
          matchId: p.matchId,
          publicationId: p.publicationId,
          revision: '2',
          locale: 'cs',
          publication: 'withdrawn',
        };
        projections.set(keyFor(p.matchId, 'cs'), withdrawn);
        const worker = service(destination('cs', 'fixture'));
        await worker.accept(event(withdrawn));
        await drain(worker);
        const body = current.payloads.at(-1)?.body;
        check(
          'Existing message scrubbed rather than reposted',
          current.payloads.every((p) => p.operation === 'edit') &&
            body?.embeds.length === 0 &&
            body?.components.length === 0 &&
            body?.content.includes('stažen') === true,
          'Actual Discord HTTP PATCH has no stale title, result or signup controls.',
        );
        const before = writes;
        const text = await signup('cs', 'join');
        check(
          'Copied old button rejected by canonical binding',
          writes === before && text.includes('aktuální'),
          'Website context independently observes the withdrawn projection.',
        );
      },
    );
    report.summary = {
      total: report.scenarios.length,
      passed: report.scenarios.filter((s) => s.status === 'passed').length,
      failed: report.scenarios.filter((s) => s.status === 'failed').length,
    };
  } finally {
    if (server)
      await new Promise<void>((resolve) => {
        server!.closeAllConnections();
        server!.close(() => resolve());
      });
    await pool.end();
    try {
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
  report.environment.database =
    'Real dedicated PostgreSQL; isolated random schema removed after run';
  return report;
}

async function main() {
  const directory = '.local/lab';
  const output = `${directory}/extensions-report.json`;
  await mkdir(directory, { recursive: true });
  const save = async (value: unknown) => {
    await writeFile(`${output}.pending`, `${JSON.stringify(value, null, 2)}\n`);
    await rename(`${output}.pending`, output);
  };
  const incomplete = {
    schemaVersion: 1,
    evidenceKind: 'simulated-discord-extensions',
    executionStatus: 'running',
    generatedAt: new Date().toISOString(),
    scenarios: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };
  await save(incomplete);
  try {
    if (process.argv.length !== 2 || !process.env.LAB_DATABASE_URL)
      throw Error('LAB_CONFIGURATION');
    const report = await runExtensionsLab(process.env.LAB_DATABASE_URL);
    await save(report);
    console.log(JSON.stringify({ report: output, ...report.summary, revision: report.revision }));
    if (report.summary.failed || report.summary.total === 0) process.exitCode = 1;
  } catch {
    await save({ ...incomplete, executionStatus: 'failed' });
    console.error('extensions_lab_failed: check disposable LAB_DATABASE_URL and focused tests.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
