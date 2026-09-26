# Website publications and server status boards

This module implements durable bot-side publication. The website feed, canonical
projection and binding API are a proposed cross-repository contract; a real website
implementation and native Discord acceptance remain separate gates. No live message,
provider observation or production integration follows from local fixture evidence.

## Runtime boundaries

`PublicationService` consumes authenticated events from the website client, persists
them through `PostgresPublicationStore`, then creates/edits messages through
`DiscordPublicationTransport`. `StatusBoardPoller` supplies bounded observations from
configured read-only server adapters. Migration `003_publications.sql` is explicit;
startup must not migrate. Recovery runs only while the existing runtime lease is held.

Publication and signup are separate opt-in gates. Disabled publication performs no
delivery or polling. `signupEnabled` defaults to false even when a published match
advertises open signup. Every delivery verifies a configured destination and calls
the runtime's `authorizeDestination` adapter to verify its actual guild/channel and
required bot permissions. Channel names and role names never identify a destination.

The production Discord REST client must use bounded timeouts, `retries: 0` and
`rejectOnRateLimit: () => true`. The publication module owns persisted retry decisions;
the transport must not hide retries after an uncertain create.

## Canonical website contract

The strict schemas in `src/publications/contracts.ts` define the accepted wire data.
An event is `{schemaVersion: 1, eventId, guildId, projection}`. IDs are UUIDs for
entities/events and decimal strings for Discord snowflakes. `revision` is a positive
decimal string, never a JavaScript number. Event IDs are immutable: a repeated ID
with different canonical bytes is rejected. Reusing a revision with different
projection content is also rejected; older revisions cannot overwrite newer ones.

A published projection contains only `matchId`, `publicationId`, revision/locale,
publication state, fixture status, start instant, `Europe/Prague`, public URL, game,
opponent, competition, signup state and nullable verified result. There is no draft
recap, private roster, account identifier, notes or arbitrary media URL field. Results
require completion, nonnegative bounded scores, `verified: true` and a consistent
win/loss/draw outcome. Absent scores never become `0:0`. A withdrawn projection carries
only identity/version/locale and `publication: withdrawn`.

The service re-fetches `latest(matchId, locale)` before sending, validates the configured
website origin and localized `/cs/matches/` or `/en/matches/` path, then fences the
attempt against the newest locally accepted revision. Transport/service credentials
authenticate the source; an untrusted caller must never invoke `accept` directly.
The website client/feed adapter owns signing, bounded HTTP and durable cursor handling.

For an open fixture, the initial message has no signup controls. The bot saves its
returned message ID before calling `bindPublication` with the exact publication,
match, revision, guild, channel, message and locale. Only an acknowledged binding,
a second unchanged canonical read and fresh destination authorization enable buttons.
Immediately before that controls edit, a database fence requires the same sending
lease, saved message ID and desired revision. An intervening withdrawal or lost lease
therefore cannot enable controls from the older attempt.
Binding failures retain the same message ID and retry; they cannot create another post.
The website still authorizes each signup action and validates the source-message binding.
Bot publication never creates a website session or a second roster database.

## Delivery and recovery

One binding exists per guild, entity, channel, locale and purpose (`fixture`, `result`
or `status`). Claims are durable and one worker owns each attempt. Known message IDs
are edited, including corrections, postponement and cancellation. An existing result
message edit carries `Aktualizovaný výsledek` / `Updated result` in its embed title and
a translated update notice above it. The renderer receives explicit edit context;
a canonical revision above 1 alone does not label a first Discord post as an update.
This label means the existing message was updated, not that the prior score was wrong.
The canonical revision remains visible in both initial and updated messages.
Fixture times use `Europe/Prague` with its daylight-saving rules and display the zone.
Retraction clears previous embeds, attachments and components and
leaves a short localized withdrawal notice. Unpublished/unverified results do not
create a message; existing result messages are redacted instead. Published cancellation
keeps its public fixture facts while clearly marking cancellation and removing controls.

The transition to `sending` commits before Discord I/O. A crash or ambiguous response
after a create attempt without a durably recorded message ID becomes `unknown`.
Neither restart nor a new website revision resets that state or blindly reposts.
Inspect the binding/audit and reconcile the actual Discord message before a separately
reviewed recovery action; this module deliberately offers no automatic recreate command.

Creates include a stable nonce and `enforce_nonce` as additional protection. Discord
deduplicates nonces only over a recent window, so this is not an indefinite exactly-once
guarantee. A missing/invalid successful-response message ID is an uncertain create.
See the [Discord message contract](https://docs.discord.com/developers/resources/message#create-message).

An interrupted claim before sending is retryable. Interrupted or timed-out edits of
a known message retry against current canonical data. Explicit 429 rejection preserves
the binding and honors its retry delay; other retryable operations use exponential
backoff and at most eight claims for a revision. Delays are bounded; invalid/extreme
rate-limit hints fail closed. Forbidden/deleted messages fail without replacement.
Failures never log raw payloads, tokens or private website/provider exception text.

Publication and Discord are separate systems: an already in-flight send cannot be
atomically recalled when the website changes. Version fencing and the next canonical
delivery converge it to the current state; audit and delivery failure remain observable.

## Status freshness

Configure each board with an allowlisted server, destination, label, polling interval
30–300 seconds and freshness 60–600 seconds, at least twice the polling interval.
Boards sharing a server/locale must share that observation policy. One due board is
polled per tick, overlapping ticks are coalesced and each provider read is bounded
to five seconds. Runtime configuration must validate server IDs against real adapters.

Only a successful validated read creates an observation timestamp and expiry. A failed
read preserves an earlier sample as STALE or shows UNKNOWN without a sample; it never
fabricates OFFLINE, zero players or a map. Null match time stays absent. Every displayed
sample includes its UTC observation time and explicit validity boundary, so an abandoned
board does not assert perpetual live status. Once expired, rendering treats it as STALE.

Observations survive restart. Identical observations do not enqueue another edit until
the freshness heartbeat (half the configured freshness); changed fields/state enqueue
an update to the same message. No player identities or game controls are published.

## Language, imagery and evidence

Destinations explicitly select `cs` or `en`; the runtime default is Czech. Labels and
dates render in Czech/English with the fixture's explicit Prague timezone. A user's
language preference never changes a shared message. All mentions are disabled and
provider text is escaped and bounded to embed limits.

This implementation uses text embeds and clears attachments explicitly. Presskit images
remain optional reviewed future presentation, not evidence of a match or server state;
no arbitrary remote image loading or runtime asset packaging is introduced here.

Run `pnpm exec vitest run tests/publications.test.ts tests/publications-status.test.ts
tests/publications-transport.test.ts` and, with a disposable `TEST_DATABASE_URL`,
`pnpm exec vitest run tests/integration/publications.test.ts`. The latter uses its own
temporary schema. Tests cover real PostgreSQL ordering/claims/recovery, real loopback
Discord REST serialization, withdrawal, binding failure, authorization, corrections,
rate limits and observation coalescing. They do not prove a deployed website API,
native Discord rendering/permissions or the actual Wardogs provider. Keep those gates
open and attach captioned Czech/English proof under the repository evidence policy.
