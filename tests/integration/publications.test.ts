import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/persistence/migrations.js';
import { PostgresPublicationStore } from '../../src/publications/store.js';
import { PublicationService } from '../../src/publications/service.js';
import { PublicationTransportError } from '../../src/publications/transport.js';
import type {
  MatchProjection,
  PublicationDestination,
  PublicationEvent,
  PublicationPayload,
} from '../../src/publications/contracts.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must name disposable PostgreSQL');
const schema = `publications_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 6,
});
const guildId = '111111111111111111';
const destination: PublicationDestination = {
  guildId,
  channelId: '222222222222222222',
  locale: 'cs',
  purpose: 'fixture',
};
const matchId = 'a1111111-1111-4111-8111-111111111111';
const pubId = 'b1111111-1111-4111-8111-111111111111';
const initial = (): MatchProjection => ({
  schemaVersion: 1,
  matchId,
  publicationId: pubId,
  revision: '1',
  locale: 'cs',
  publication: 'published',
  status: 'scheduled',
  startsAt: '2026-10-25T18:00:00Z',
  timeZone: 'Europe/Prague',
  publicUrl: 'https://valkyriawdg.cz/cs/matches/example',
  game: 'Wardogs',
  opponent: 'Example',
  competition: 'Friendly',
  signup: 'open',
  result: null,
});
const event = (projection = initial()): PublicationEvent => ({
  schemaVersion: 1,
  eventId: randomUUID(),
  guildId,
  projection,
});
const store = new PostgresPublicationStore(pool, guildId);
const now = new Date('2026-09-26T18:00:00Z');
const rows = async () => (await pool.query('SELECT * FROM publication_bindings ORDER BY id')).rows;

describe('durable publication boundaries on real PostgreSQL', () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE publication_receipts, publication_bindings, publication_projections, publication_audit CASCADE',
    );
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it('deduplicates exact receipts, rejects changed digests and fences out-of-order revisions', async () => {
    const first = event();
    expect(await store.ingest(first, [destination])).toBe('accepted');
    expect(await store.ingest(first, [destination])).toBe('duplicate');
    await expect(
      store.ingest({ ...first, projection: { ...first.projection, revision: '2' } }, [destination]),
    ).rejects.toThrow('publication_event_conflict');
    expect(await store.ingest(event({ ...initial(), revision: '3' }), [destination])).toBe(
      'accepted',
    );
    expect(await store.ingest(event({ ...initial(), revision: '2' }), [destination])).toBe('stale');
    expect((await rows())[0].desired_revision).toBe('3');
    expect(await rows()).toHaveLength(1);
  });
  it('claims once and a crash after create attempt becomes UNKNOWN permanently', async () => {
    await store.ingest(event(), [destination]);
    const claims = await Promise.all([store.claim(now), store.claim(now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find(Boolean)!;
    expect(await store.beginAttempt(job, '1')).toBe(true);
    expect(await store.recover()).toBe(1);
    expect((await rows())[0].state).toBe('unknown');
    await store.ingest(event({ ...initial(), revision: '2' }), [destination]);
    expect(await store.claim(new Date(now.getTime() + 1_000_000))).toBeNull();
  });
  it('recovers harmless pre-send claims and edits with known message IDs', async () => {
    await store.ingest(event(), [destination]);
    await store.claim(now);
    await store.recover();
    const job = (await store.claim(now))!;
    await store.beginAttempt(job, '1');
    await store.saveMessageId(job, '333333333333333333');
    await store.recover();
    const resumed = (await store.claim(now))!;
    expect(resumed.messageId).toBe('333333333333333333');
  });
  it('rechecks canonical publication and suppresses a withdrawn event before any create', async () => {
    const sends: PublicationPayload[] = [];
    const withdrawn: MatchProjection = {
      schemaVersion: 1,
      matchId,
      publicationId: pubId,
      revision: '2',
      locale: 'cs',
      publication: 'withdrawn',
    };
    const service = new PublicationService({
      store,
      authorizeDestination: async () => true,
      signupEnabled: true,
      enabled: true,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: { latest: async () => withdrawn, bindPublication: async () => undefined },
      transport: {
        create: async (_c, body) => {
          sends.push(body);
          return '333333333333333333';
        },
        edit: async (_c, _m, body) => {
          sends.push(body);
        },
      },
    });
    await service.accept(event());
    await service.tick();
    expect(sends).toEqual([]);
    expect((await rows())[0].state).toBe('suppressed');
  });
  it('enables controls only for the current sending lease and its saved message', async () => {
    await store.ingest(event(), [destination]);
    const job = (await store.claim(now))!;
    expect(await store.canEnableControls(job, '1')).toBe(false);
    await store.beginAttempt(job, '1');
    expect(await store.canEnableControls(job, '1')).toBe(false);
    await store.saveMessageId(job, '333333333333333333');
    job.messageId = '333333333333333333';
    expect(await store.canEnableControls(job, '1')).toBe(true);
    expect(await store.canEnableControls({ ...job, leaseId: randomUUID() }, '1')).toBe(false);
    expect(await store.canEnableControls({ ...job, messageId: '444444444444444444' }, '1')).toBe(
      false,
    );
    expect(await store.canEnableControls(job, '2')).toBe(false);
    await store.recover();
    expect(await store.canEnableControls(job, '1')).toBe(false);
    expect((await rows())[0]).toMatchObject({ state: 'pending', message_id: job.messageId });
  });
  it('persists create ID before binding and retries binding without reposting or exposing controls', async () => {
    const sends: PublicationPayload[] = [];
    let creates = 0,
      bindCalls = 0;
    let clock = now;
    const service = new PublicationService({
      store,
      authorizeDestination: async () => true,
      signupEnabled: true,
      enabled: true,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => clock,
      source: {
        latest: async () => initial(),
        bindPublication: async () => {
          if (++bindCalls === 1) throw new Error('timeout');
        },
      },
      transport: {
        create: async (_c, body) => {
          creates++;
          sends.push(body);
          return '333333333333333333';
        },
        edit: async (_c, _m, body) => {
          sends.push(body);
        },
      },
    });
    await service.accept(event());
    await service.tick();
    expect(sends[0]?.components).toEqual([]);
    expect((await rows())[0].message_id).toBe('333333333333333333');
    clock = new Date(now.getTime() + 100_000);
    await service.tick();
    expect(creates).toBe(1);
    expect(bindCalls).toBe(2);
    expect(sends.at(-1)?.components).toHaveLength(1);
    expect((await rows())[0].state).toBe('delivered');
  });
  it('uncertain creates never retry, while known 429 creates wait', async () => {
    let calls = 0;
    const service = new PublicationService({
      store,
      authorizeDestination: async () => true,
      signupEnabled: true,
      enabled: true,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: { latest: async () => initial(), bindPublication: async () => undefined },
      transport: {
        create: async () => {
          calls++;
          throw new Error('network timeout');
        },
        edit: async () => undefined,
      },
    });
    await service.accept(event());
    await service.tick();
    await service.tick();
    expect(calls).toBe(1);
    expect((await rows())[0].state).toBe('unknown');
    await pool.query(
      'TRUNCATE publication_receipts, publication_bindings, publication_projections, publication_audit CASCADE',
    );
    const limited = new PublicationService({
      store,
      authorizeDestination: async () => true,
      signupEnabled: true,
      enabled: true,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: { latest: async () => initial(), bindPublication: async () => undefined },
      transport: {
        create: async () => {
          throw new PublicationTransportError('rate_limited', 20_000);
        },
        edit: async () => undefined,
      },
    });
    await limited.accept(event());
    await limited.tick();
    expect((await rows())[0].state).toBe('pending');
    expect(await store.claim(new Date(now.getTime() + 19_000))).toBeNull();
  });
  it('disabled publication performs no source or Discord I/O', async () => {
    const blocked = async (): Promise<never> => {
      throw new Error('unexpected I/O');
    };
    const service = new PublicationService({
      store,
      authorizeDestination: async () => true,
      signupEnabled: true,
      enabled: false,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      source: { latest: blocked, bindPublication: blocked },
      transport: { create: blocked, edit: blocked },
    });
    await service.tick();
    expect(await rows()).toHaveLength(0);
  });
  it('requires destination authorization and the separate signup enablement gate', async () => {
    let allowed = false,
      creates = 0,
      binds = 0;
    const bodies: PublicationPayload[] = [];
    const service = new PublicationService({
      store,
      enabled: true,
      signupEnabled: false,
      authorizeDestination: async () => allowed,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: {
        latest: async () => initial(),
        bindPublication: async () => {
          binds++;
        },
      },
      transport: {
        create: async (_c, b) => {
          creates++;
          bodies.push(b);
          return '333333333333333333';
        },
        edit: async () => undefined,
      },
    });
    await service.accept(event());
    await service.tick();
    expect(creates).toBe(0);
    expect((await rows())[0].last_code).toBe('destination_denied');
    allowed = true;
    await pool.query(
      'TRUNCATE publication_receipts, publication_bindings, publication_projections, publication_audit CASCADE',
    );
    await service.accept(event());
    await service.tick();
    expect(creates).toBe(1);
    expect(binds).toBe(0);
    expect(bodies[0]?.components).toEqual([]);
  });
  it('never recreates a deleted Discord message and retries safe edits without another create', async () => {
    let clock = now,
      creates = 0,
      edits = 0;
    let current = initial();
    let failure: 'none' | 'uncertain' | 'deleted' = 'none';
    const service = new PublicationService({
      store,
      enabled: true,
      authorizeDestination: async () => true,
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => clock,
      source: { latest: async () => current, bindPublication: async () => undefined },
      transport: {
        create: async () => {
          creates++;
          return '333333333333333333';
        },
        edit: async () => {
          edits++;
          if (failure !== 'none') throw new PublicationTransportError(failure);
        },
      },
    });
    await service.accept(event());
    await service.tick();
    current = { ...initial(), revision: '2' };
    await service.accept(event(current));
    failure = 'uncertain';
    await service.tick();
    expect((await rows())[0].state).toBe('pending');
    clock = new Date(clock.getTime() + 10_000);
    failure = 'none';
    await service.tick();
    expect(creates).toBe(1);
    expect(edits).toBe(2);
    expect((await rows())[0].state).toBe('delivered');
    current = { ...initial(), revision: '3' };
    await service.accept(event(current));
    failure = 'deleted';
    await service.tick();
    expect((await rows())[0].state).toBe('failed');
    expect((await rows())[0].last_code).toBe('deleted');
    await service.tick();
    expect(creates).toBe(1);
  });
  it('edits result corrections and redacts a retracted verified result instead of posting again', async () => {
    const resultDestination = { ...destination, purpose: 'result' as const };
    let current: MatchProjection = {
      ...initial(),
      publication: 'published',
      status: 'completed',
      signup: 'closed',
      startsAt: '2026-10-25T18:00:00Z',
      timeZone: 'Europe/Prague',
      publicUrl: 'https://valkyriawdg.cz/cs/matches/example',
      game: 'Wardogs',
      opponent: 'Example',
      competition: 'Friendly',
      result: { homeScore: 2, awayScore: 1, verified: true, outcome: 'win' },
    };
    let creates = 0;
    const edits: PublicationPayload[] = [];
    const service = new PublicationService({
      store,
      enabled: true,
      authorizeDestination: async () => true,
      destinations: [resultDestination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: { latest: async () => current, bindPublication: async () => undefined },
      transport: {
        create: async () => {
          creates++;
          return '333333333333333333';
        },
        edit: async (_c, _m, b) => {
          edits.push(b);
        },
      },
    });
    await service.accept(event(current));
    await service.tick();
    current = {
      ...current,
      revision: '2',
      result: { homeScore: 1, awayScore: 2, verified: true, outcome: 'loss' },
    };
    await service.accept(event(current));
    await service.tick();
    expect(edits[0]?.content).toContain('aktualizován');
    expect(edits[0]?.embeds[0]?.title).toContain('Aktualizovaný výsledek');
    expect(JSON.stringify(edits[0])).toContain('1 : 2');
    current = {
      schemaVersion: 1,
      matchId,
      publicationId: pubId,
      revision: '3',
      locale: 'cs',
      publication: 'withdrawn',
    };
    await service.accept(event(current));
    await service.tick();
    expect(creates).toBe(1);
    expect(edits[1]?.embeds).toEqual([]);
    expect(edits[1]?.attachments).toEqual([]);
    expect(edits[1]?.components).toEqual([]);
  });
  it('fences an event arriving during canonical verification before send', async () => {
    let sends = 0;
    const service = new PublicationService({
      store,
      enabled: true,
      authorizeDestination: async () => {
        await store.ingest(event({ ...initial(), revision: '2' }), [destination]);
        return true;
      },
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => now,
      source: { latest: async () => initial(), bindPublication: async () => undefined },
      transport: {
        create: async () => {
          sends++;
          return '333333333333333333';
        },
        edit: async () => undefined,
      },
    });
    await service.accept(event());
    await service.tick();
    expect(sends).toBe(0);
    expect((await rows())[0].desired_revision).toBe('2');
  });
  it('does not enable stale signup controls after a withdrawal arrives during destination authorization', async () => {
    let authorizations = 0,
      creates = 0;
    let clock = now;
    let current = initial();
    const edits: PublicationPayload[] = [];
    const service = new PublicationService({
      store,
      enabled: true,
      signupEnabled: true,
      authorizeDestination: async () => {
        if (++authorizations === 2) {
          current = {
            schemaVersion: 1,
            matchId,
            publicationId: pubId,
            revision: '2',
            locale: 'cs',
            publication: 'withdrawn',
          };
          await store.ingest(event(current), [destination]);
        }
        return true;
      },
      destinations: [destination],
      websiteOrigin: 'https://valkyriawdg.cz',
      now: () => clock,
      source: { latest: async () => current, bindPublication: async () => undefined },
      transport: {
        create: async () => {
          creates++;
          return '333333333333333333';
        },
        edit: async (_c, _m, body) => {
          edits.push(body);
        },
      },
    });
    await service.accept(event());
    await service.tick();
    expect(edits).toEqual([]);
    expect((await rows())[0]).toMatchObject({
      desired_revision: '2',
      state: 'pending',
      message_id: '333333333333333333',
      delivered_revision: null,
    });
    clock = new Date(now.getTime() + 10_000);
    await service.tick();
    expect(creates).toBe(1);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ embeds: [], components: [], attachments: [] });
    expect((await rows())[0]).toMatchObject({ state: 'delivered', delivered_revision: '2' });
  });
  it('coalesces unchanged status observations until heartbeat while preserving observation time on failure', async () => {
    const dest = { ...destination, purpose: 'status' as const };
    const observation = {
      kind: 'status' as const,
      serverId: 'primary',
      label: 'Primary',
      locale: 'cs' as const,
      state: 'current' as const,
      observedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 90_000).toISOString(),
      sample: {
        serverName: 'Primary',
        map: 'EXAMPLE',
        playerCount: 16,
        maxPlayers: 100,
        matchSeconds: null,
      },
    };
    expect(await store.observeStatus(dest, observation, 45_000, now)).toBe(true);
    const job = (await store.claim(now))!;
    await store.beginAttempt(job, '1');
    await store.saveMessageId(job, '333333333333333333');
    await store.finish(job, '1', 'delivered', 'delivered');
    expect(
      await store.observeStatus(
        dest,
        { ...observation, observedAt: new Date(now.getTime() + 30_000).toISOString() },
        45_000,
        new Date(now.getTime() + 30_000),
      ),
    ).toBe(false);
    expect(await store.claim(new Date(now.getTime() + 30_000))).toBeNull();
    expect(
      await store.observeStatus(
        dest,
        { ...observation, state: 'stale' },
        45_000,
        new Date(now.getTime() + 60_000),
      ),
    ).toBe(true);
    expect((await store.status('primary', 'cs'))?.observedAt).toBe(now.toISOString());
    expect((await store.claim(new Date(now.getTime() + 60_000)))?.messageId).toBe(
      '333333333333333333',
    );
  });
});
