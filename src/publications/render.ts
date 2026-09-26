import type {
  MatchProjection,
  PublicationPayload,
  PublicationPurpose,
  StatusProjection,
} from './contracts.js';

const safe = (value: string, limit = 320) =>
  value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/@/g, '＠')
    .replace(/([\\*_~`|<>[\]])/g, '\\$1')
    .slice(0, limit);
const empty = (content = ''): PublicationPayload => ({
  content,
  embeds: [],
  components: [],
  attachments: [],
  allowed_mentions: { parse: [] },
});

export function renderMatch(
  p: MatchProjection,
  purpose: Exclude<PublicationPurpose, 'status'>,
  bound: boolean,
  context: { resultUpdate?: boolean } = {},
): PublicationPayload | null {
  const cs = p.locale === 'cs';
  if (p.publication === 'withdrawn')
    return empty(
      cs
        ? 'Příspěvek byl stažen. Aktuální informace najdete na webu klanu.'
        : 'This publication was withdrawn. Consult the clan website for current information.',
    );
  if (purpose === 'result' && !p.result) return null;
  const statuses = {
    scheduled: cs ? 'Naplánováno' : 'Scheduled',
    live: cs ? 'Probíhá' : 'In progress',
    completed: cs ? 'Dokončeno' : 'Completed',
    postponed: cs ? 'Odloženo' : 'Postponed',
    cancelled: cs ? 'Zrušeno' : 'Cancelled',
  };
  const score = p.result ? `${p.result.homeScore} : ${p.result.awayScore}` : 'VS';
  const resultUpdate = purpose === 'result' && context.resultUpdate === true;
  const body = empty(
    resultUpdate ? (cs ? 'Výsledek byl aktualizován.' : 'The result has been updated.') : '',
  );
  const label =
    purpose === 'result'
      ? resultUpdate
        ? cs
          ? 'Aktualizovaný výsledek'
          : 'Updated result'
        : cs
          ? 'Výsledek'
          : 'Result'
      : cs
        ? 'Zápas'
        : 'Match';
  body.embeds.push({
    title: `${label} · Valkyria ${score} ${safe(p.opponent, 170)}`,
    description: `${safe(p.game)} · ${safe(p.competition)}\n${statuses[p.status]}\n${new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: p.timeZone }).format(new Date(p.startsAt))} (${p.timeZone})\n${cs ? 'Aktuální verze' : 'Current revision'}: ${p.revision}`,
    url: p.publicUrl,
    color: p.status === 'cancelled' ? 7632760 : 15115853,
  });
  if (purpose === 'fixture' && bound && p.signup === 'open' && p.status === 'scheduled') {
    body.components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: cs ? 'Přihlásit se' : 'Join',
            custom_id: `vlk:signup:join:${p.publicationId}:${p.locale}`,
          },
          {
            type: 2,
            style: 2,
            label: cs ? 'Odhlásit se' : 'Withdraw',
            custom_id: `vlk:signup:withdraw:${p.publicationId}:${p.locale}`,
          },
          {
            type: 2,
            style: 2,
            label: cs ? 'Moje účast' : 'My participation',
            custom_id: `vlk:signup:mine:${p.publicationId}:${p.locale}`,
          },
        ],
      },
    ];
  }
  return body;
}

export function renderStatus(p: StatusProjection, now: Date): PublicationPayload {
  const cs = p.locale === 'cs';
  const state = !p.sample
    ? 'UNKNOWN'
    : p.state === 'current' && p.validUntil && Date.parse(p.validUntil) > now.getTime()
      ? 'CURRENT'
      : 'STALE';
  const body = empty();
  body.embeds.push({
    title: `${cs ? 'Stav serveru' : 'Server status'} · ${safe(p.label, 180)} · ${state}`,
    description:
      state === 'UNKNOWN'
        ? cs
          ? 'Stav není ověřen. Nejde o potvrzení, že je server vypnutý.'
          : 'State is not verified. This does not confirm that the server is offline.'
        : state === 'STALE'
          ? cs
            ? 'Starší pozorování; aktuální stav není ověřen.'
            : 'Older observation; current state is not verified.'
          : cs
            ? 'Ověřené pozorování platné pouze do uvedeného času.'
            : 'Observed state, valid only until the stated time.',
    color: state === 'CURRENT' ? 15115853 : 7632760,
    fields: p.sample
      ? [
          {
            name: cs ? 'Hráči při pozorování' : 'Players observed',
            value: `${p.sample.playerCount} / ${p.sample.maxPlayers}`,
          },
          { name: cs ? 'Mapa při pozorování' : 'Map observed', value: safe(p.sample.map) },
          ...(p.sample.matchSeconds === null
            ? []
            : [
                {
                  name: cs ? 'Čas zápasu při pozorování' : 'Match time observed',
                  value: `${p.sample.matchSeconds} s`,
                },
              ]),
          { name: cs ? 'Pozorováno (UTC)' : 'Observed (UTC)', value: p.observedAt! },
          { name: cs ? 'Platnost do (UTC)' : 'Valid until (UTC)', value: p.validUntil! },
        ]
      : [],
  });
  return body;
}
