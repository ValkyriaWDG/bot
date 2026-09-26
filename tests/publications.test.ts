import { describe, expect, it } from 'vitest';
import { parseMatchProjection, parsePublicationEvent } from '../src/publications/contracts.js';
import { renderMatch, renderStatus } from '../src/publications/render.js';

export const projection = () => ({
  schemaVersion: 1 as const,
  matchId: 'a1111111-1111-4111-8111-111111111111',
  publicationId: 'b1111111-1111-4111-8111-111111111111',
  revision: '1',
  locale: 'cs' as const,
  publication: 'published' as const,
  status: 'scheduled' as const,
  startsAt: '2026-10-25T18:00:00Z',
  timeZone: 'Europe/Prague' as const,
  publicUrl: 'https://valkyriawdg.cz/cs/matches/example',
  game: 'Wardogs',
  opponent: 'Example team',
  competition: 'Friendly',
  signup: 'open' as const,
  result: null,
});

describe('strict public publication contracts and rendering', () => {
  it('rejects draft/private fields, imprecise revisions and unverified results', () => {
    expect(() => parseMatchProjection({ ...projection(), notes: 'private' })).toThrow();
    expect(() => parseMatchProjection({ ...projection(), revision: 9007199254740992 })).toThrow();
    expect(() => parseMatchProjection({ ...projection(), publication: 'draft' })).toThrow();
    expect(() =>
      parseMatchProjection({
        ...projection(),
        result: { homeScore: 5, awayScore: 0, verified: false, outcome: 'win' },
      }),
    ).toThrow();
    expect(() =>
      parseMatchProjection({
        ...projection(),
        publicUrl: 'https://user:secret@example.com/cs/matches/a',
      }),
    ).toThrow();
    expect(() =>
      parseMatchProjection({
        ...projection(),
        status: 'completed',
        signup: 'closed',
        result: { homeScore: 1, awayScore: 2, verified: true, outcome: 'win' },
      }),
    ).toThrow();
  });
  it('keeps unknown scores unknown, disables mentions and escapes provider text', () => {
    const value = parseMatchProjection({ ...projection(), opponent: '@everyone **opponent**' });
    const fixture = renderMatch(value, 'fixture', false)!;
    expect(fixture.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(fixture)).not.toContain('0 : 0');
    expect(JSON.stringify(fixture)).toContain('VS');
    expect(JSON.stringify(fixture)).not.toContain('@everyone');
    expect(renderMatch(value, 'result', false)).toBeNull();
    expect(fixture.components).toEqual([]);
  });
  it('renders Czech and English verified results with no signup controls', () => {
    const value = parseMatchProjection({
      ...projection(),
      status: 'completed',
      signup: 'closed',
      result: { homeScore: 2, awayScore: 1, verified: true, outcome: 'win' },
    });
    expect(JSON.stringify(renderMatch(value, 'result', true))).toContain('Výsledek');
    expect(
      JSON.stringify(
        renderMatch(
          parseMatchProjection({
            ...value,
            locale: 'en',
            publicUrl: 'https://valkyriawdg.cz/en/matches/example',
          }),
          'result',
          true,
        ),
      ),
    ).toContain('Result');
    expect(renderMatch(value, 'result', true)?.components).toEqual([]);
  });
  it('only enables signup buttons after binding acknowledgement', () => {
    const value = parseMatchProjection(projection());
    expect(renderMatch(value, 'fixture', false)?.components).toEqual([]);
    expect(JSON.stringify(renderMatch(value, 'fixture', true))).toContain(
      `vlk:signup:join:${value.publicationId}:cs`,
    );
  });
  it.each([
    ['cs', 'Aktualizovaný výsledek', 'Výsledek byl aktualizován.'],
    ['en', 'Updated result', 'The result has been updated.'],
  ] as const)(
    'labels an existing result update in %s without mislabeling a first post',
    (locale, title, content) => {
      const value = parseMatchProjection({
        ...projection(),
        locale,
        revision: '3',
        publicUrl: `https://valkyriawdg.cz/${locale}/matches/example`,
        status: 'completed',
        signup: 'closed',
        result: { homeScore: 2, awayScore: 1, verified: true, outcome: 'win' },
      });
      const update = renderMatch(value, 'result', false, { resultUpdate: true })!;
      expect(update.content).toBe(content);
      expect(update.embeds[0]!.title).toContain(title);
      expect(update.embeds[0]!.description).toContain(': 3');
      expect(renderMatch(value, 'result', false)!.content).toBe('');
      expect(renderMatch(value, 'result', false)!.embeds[0]!.title).not.toContain(title);
    },
  );
  it.each(['cs', 'en'] as const)(
    'renders the Prague spring DST boundary correctly in %s',
    (locale) => {
      const value = parseMatchProjection({
        ...projection(),
        locale,
        publicUrl: `https://valkyriawdg.cz/${locale}/matches/example`,
        startsAt: '2026-03-29T00:30:00Z',
      });
      const before = renderMatch(value, 'fixture', false)!.embeds[0]!.description;
      const after = renderMatch(
        parseMatchProjection({ ...value, startsAt: '2026-03-29T01:30:00Z' }),
        'fixture',
        false,
      )!.embeds[0]!.description;
      expect(before).toMatch(/(?:^|\s)0?1:30 \(Europe\/Prague\)/);
      expect(after).toMatch(/(?:^|\s)0?3:30 \(Europe\/Prague\)/);
      expect(after).not.toContain('2:30');
    },
  );
  it('bounds escaped display text to actual embed limits', () => {
    const value = parseMatchProjection({ ...projection(), opponent: '*'.repeat(160) });
    const body = renderMatch(value, 'fixture', false)!;
    expect(body.embeds[0]!.title.length).toBeLessThanOrEqual(256);
    expect(body.embeds[0]!.description.length).toBeLessThanOrEqual(4096);
  });
  it('cancellation and withdrawal clear old embeds, attachments and controls', () => {
    const cancelled = parseMatchProjection({
      ...projection(),
      status: 'cancelled',
      signup: 'closed',
    });
    expect(renderMatch(cancelled, 'fixture', true)?.components).toEqual([]);
    expect(renderMatch(cancelled, 'fixture', true)?.attachments).toEqual([]);
    const withdrawn = parseMatchProjection({
      schemaVersion: 1,
      matchId: projection().matchId,
      publicationId: projection().publicationId,
      revision: '3',
      locale: 'cs',
      publication: 'withdrawn',
    });
    const rendered = renderMatch(withdrawn, 'fixture', true)!;
    expect(rendered.embeds).toEqual([]);
    expect(rendered.attachments).toEqual([]);
    expect(rendered.components).toEqual([]);
    expect(JSON.stringify(rendered)).not.toContain('Example team');
  });
  it('validates event envelopes strictly', () => {
    const event = {
      schemaVersion: 1,
      eventId: 'c1111111-1111-4111-8111-111111111111',
      guildId: '111111111111111111',
      projection: projection(),
    };
    expect(parsePublicationEvent(event).projection.revision).toBe('1');
    expect(() =>
      parsePublicationEvent({ ...event, guildId: Number('111111111111111111') }),
    ).toThrow();
  });
  it('shows UNKNOWN without samples and STALE instead of fabricated offline/zero values', () => {
    const empty = {
      kind: 'status' as const,
      serverId: 'primary',
      label: 'Primary',
      locale: 'cs' as const,
      state: 'unknown' as const,
      observedAt: null,
      validUntil: null,
      sample: null,
    };
    expect(JSON.stringify(renderStatus(empty, new Date('2026-01-01T12:00:00Z')))).toContain(
      'UNKNOWN',
    );
    expect(JSON.stringify(renderStatus(empty, new Date()))).not.toContain('0 /');
    const stale = {
      ...empty,
      locale: 'en' as const,
      state: 'current' as const,
      observedAt: '2026-01-01T12:00:00Z',
      validUntil: '2026-01-01T12:01:30Z',
      sample: {
        serverName: 'Primary',
        map: 'EXAMPLE',
        playerCount: 16,
        maxPlayers: 100,
        matchSeconds: null,
      },
    };
    const body = JSON.stringify(renderStatus(stale, new Date('2026-01-01T12:02:00Z')));
    expect(body).toContain('STALE');
    expect(body).toContain('16 / 100');
    expect(body).not.toContain('OFFLINE');
    expect(body).toContain('2026-01-01T12:00:00Z');
  });
});
