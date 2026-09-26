# Website publication and participation protocol

This is the implemented **bot-side proposal**, version 1. The separate website must
implement and independently verify the receiver, canonical transactions and API before
operators enable it. Local HTTP fixtures prove bot request handling and presentation;
they do not establish website compatibility, real capacity enforcement or live Discord
delivery. The website owns matches, publication/translation state, account linking,
eligibility, capacity, waiting lists, roster locks and participation. The bot keeps no
canonical roster database and cannot create website accounts, sessions or admin grants.

Sources of executable truth:

- [Website client](../src/website/client.ts): fixed routes, authentication, transport limits.
- [Publication schemas](../src/publications/contracts.ts): canonical projections/events/bindings.
- [Signup schemas](../src/signup/contracts.ts) and [interaction handler](../src/signup/handler.ts).
- [Publication delivery](publications.md), [existing role-sync proposal](web-integration.md)
  and [management API](management-api.md) describe separate responsibilities and keys.

## Transport and signing

All production requests use the single operator-configured HTTPS website **origin**,
with no userinfo, path prefix, query or fragment in configuration. There is no arbitrary
URL/path method, credential-bearing redirect, cookie session or shared database.
Only explicit local fixture options allow HTTP at literal `127.0.0.1` or `[::1]`.
The client does not retry any request internally. Each request has a 5-second default
deadline, configurable from 10 to 10,000 milliseconds, including response reading.
Decoded request/response bodies are bounded to 256 KiB. A successful response must be
HTTP 200 with JSON content type, valid UTF-8, exact versioned schema and matching identity.
Unknown response fields are rejected, including unpublished or private content fields.

Two dedicated keys are required: `publications` and `signup`. They have different key
IDs and secret values. Never reuse management, Discord, OAuth, role-sync or RCON secrets.
Key IDs are 1–64 ASCII letters, digits, `_` or `-`; secrets are 32–4096 UTF-8 bytes.
Provision and rotate them through private environment configuration. Public examples
and tests contain only synthetic values. Errors expose fixed safe codes, not bodies,
headers, URLs with secrets, provider messages or signatures.

Every request has these headers:

| Header                   | Exact value                                            |
| ------------------------ | ------------------------------------------------------ |
| `X-Valkyria-Version`     | `1`                                                    |
| `X-Valkyria-Purpose`     | `publications` or `signup`                             |
| `X-Valkyria-Key-Id`      | Dedicated purpose key ID                               |
| `X-Valkyria-Timestamp`   | Decimal Unix seconds                                   |
| `X-Valkyria-Nonce`       | 16 random bytes as 32 lowercase hexadecimal characters |
| `X-Valkyria-Signature`   | Lowercase hexadecimal HMAC-SHA256                      |
| `Content-Type`, `Accept` | `application/json`                                     |

The signed bytes are UTF-8 encoding of the following values joined with a single LF,
with **no trailing LF**. Raw body is empty for GET. JSON property order and whitespace
are whatever the sender actually transmits; the receiver must not reserialize JSON.

```text
1
<purpose>
<uppercase HTTP method>
<exact path including the exact query string, if present>
<key ID>
<timestamp>
<nonce>
<raw body bytes>
```

The receiver must bind each key ID to its one purpose and allowlisted routes, verify
the HMAC with constant-time comparison, require the exact version, and reject timestamps
outside ±300 seconds. Atomically reserve `(key ID, nonce)` for at least 601 seconds
before handling the request; duplicate nonces are rejected across replicas. Bound bytes
before JSON parsing and reject ambiguous/duplicate authentication headers. Neither a
valid signature nor a supplied actor ID bypasses endpoint authorization. Each new
attempt gets a fresh envelope nonce/timestamp; canonical idempotency is separate from
transport replay protection. Receiver responses are authenticated by TLS, not this HMAC.

The dedicated integration identity must be constrained to the configured guild,
publication channels and endpoint operations. Do not expose these endpoints as an
anonymous public content/participation API. A compromised signer is a trusted-service
incident; its credential needs revocation and audit review.

## Publication feed and canonical snapshots

All routes below start with `/api/integrations/discord/v1` and require purpose
`publications`:

| Method/path                                      | Request                                 | HTTP 200 body                                                       |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------- |
| `GET /publication-events?after=<cursor>`         | No body; decimal cursor starting at `0` | `{schemaVersion:1,events:PublicationEvent[],nextCursor:string}`     |
| `GET /matches/<match UUID>/publication/<cs\|en>` | No body                                 | `MatchProjection`                                                   |
| `POST /publication-bindings`                     | `PublicationBinding`                    | `{schemaVersion:1,status:"bound",binding:<exact accepted request>}` |

Feed cursors are nonnegative canonical decimal strings, up to 30 digits, never JavaScript
numbers. Each page contains at most 50 distinct event IDs. `nextCursor` cannot decrease
and must advance when the page contains events. The website must return the ordered,
complete authorized segment `(after, nextCursor]`: it may not silently skip events.
Empty pages may retain the cursor or advance over records outside this integration's
authorized feed. The bot saves its durable cursor only after the entire batch is
accepted into durable publication state. Replayed pages are safe through event/revision
deduplication; a failed batch must not advance the cursor.

`PublicationEvent` is exactly `{schemaVersion:1,eventId,guildId,projection}`. UUIDs
identify events/matches/publications; Discord IDs are decimal snowflake strings.
The published projection contains exactly:

```json
{
  "schemaVersion": 1,
  "matchId": "a6c1e842-3edc-4d6c-851f-a2e94466d04c",
  "publicationId": "51f23b67-655e-438c-a86e-5096edb7ae01",
  "revision": "4",
  "locale": "cs",
  "publication": "published",
  "status": "scheduled",
  "startsAt": "2026-10-01T18:00:00Z",
  "timeZone": "Europe/Prague",
  "publicUrl": "https://valkyriawdg.cz/cs/matches/example-match",
  "game": "Wardogs",
  "opponent": "Example opponent",
  "competition": "Example fixture",
  "signup": "open",
  "result": null
}
```

Revisions are positive canonical decimal strings up to 30 digits. Status is
`scheduled|live|completed|postponed|cancelled`. Signup can be `open` only for scheduled
matches. Game/opponent/competition are bounded, nonempty text with no control/format
characters. Result is null or a verified completed score object
`{homeScore,awayScore,verified:true,outcome:"win"|"loss"|"draw"}`; scores are integers
0–1,000,000. No player roster, member identity, draft text or private recap is included.
The published URL must be HTTPS, the configured website origin, and under
`/<locale>/matches/`, without credentials, query or fragment. Each locale has its own
published projection. Missing/unpublished translations must not fall back to drafts or
another locale's unpublished content.

A withdrawn projection is only
`{schemaVersion:1,matchId,publicationId,revision,locale,publication:"withdrawn"}`.
Do not retain private title, opponent, result or other now-unpublished fields in it.
The latest read is authoritative before publication; queued older events are triggers,
not permission to resurrect withdrawn content.

The binding request contains exactly
`{schemaVersion:1,publicationId,matchId,revision,guildId,channelId,messageId,locale}`.
The website must validate the canonical publication, current revision, configured guild
and channel before committing the binding. This operation is idempotent for the exact
binding. A timeout or invalid acknowledgement leaves binding outcome unknown; the
publisher can retry the same binding with a fresh signed envelope. It must retain the
already-created Discord message and must not create a replacement as a retry shortcut.
Signup controls become active only after an exact committed binding acknowledgement.
Corrections/retractions must invalidate obsolete bindings at the website; a copied
button or old message is never sufficient authority to change participation.

## Signup context and command

Only purpose `signup` can call these fixed routes:

| Method/path                  | Input           | Output                                  |
| ---------------------------- | --------------- | --------------------------------------- |
| `POST /signup/context`       | `SignupRequest` | `SignupContext`; read-only despite POST |
| `POST /signup/participation` | `SignupCommand` | `SignupResult` after final transaction  |

Button IDs are references, not policy or credentials:
`vlk:signup:<join|withdraw|mine>:<publication UUID>:<cs|en>`.
The actor, interaction, guild, source message and source channel are taken from the
actual Discord interaction. No IDs or eligibility flags are accepted from button data.
The bot defers ephemerally before network/database IO, suppresses mentions and leaves
shared signup controls intact for other members. A failed acknowledgement performs no
downstream work.

The strict context request is:

```json
{
  "schemaVersion": 1,
  "publicationId": "51f23b67-655e-438c-a86e-5096edb7ae01",
  "locale": "cs",
  "guildId": "111111111111111111",
  "userId": "222222222222222222",
  "interactionId": "333333333333333333",
  "channelId": "444444444444444444",
  "messageId": "555555555555555555"
}
```

Ready context is exactly
`{schemaVersion:1,request:<exact request>,state:"ready",matchId,revision,signup,participation}`.
Here `revision` is the website's canonical **signup aggregate** revision for optimistic
concurrency, distinct from the public projection revision. `signup` is
`open|locked|closed`; participation is `none|joined|waitlisted|withdrawn`.
The website has resolved the linked account from the Discord snowflake, verified the
current message/channel/guild/publication/locale binding, and checked fresh eligibility.

Blocked context is exactly
`{schemaVersion:1,request:<exact request>,state:"unlinked"|"ineligible"|"obsolete",matchId:null,revision:null,signup:null,participation:null}`.
It discloses no participation state. An unlinked member gets a fixed
`<configured HTTPS origin>/<cs|en>/account` link. The bot never accepts a response-provided
login URL, provisions a local administrator or bypasses website OAuth/session ownership.

The bot fetches fresh Discord membership before the context read. It requires a present
member with matching guild/user and an observation no older than 60 seconds, never in
the future. Before Join/Withdraw it fetches fresh REST membership **again**, and stops
if membership or the set of roles changed since preflight. Role names, role lists,
display names and client input do not become website permission grants. My participation
uses the authoritative context result without a write, including when signups are locked.

Join/Withdraw commands extend the context request with exactly:

```json
{
  "action": "join",
  "expectedRevision": "4",
  "idempotencyKey": "111111111111111111:222222222222222222:333333333333333333"
}
```

The idempotency key is exactly `guildId:userId:interactionId`. The website must atomically
persist its request fingerprint, durable receipt, participation change, capacity/waitlist
decision and audit. Same key and same command returns the stored result without a second
change. Same key with a different command returns `idempotency_conflict` without applying
it. A later context revision can therefore turn an externally redelivered interaction
into a safe conflict; the bot does not invent a success. Retain receipts for at least the
supported Discord interaction replay window and operator reconciliation period, and
document that duration before enabling the integration.

Under one transaction/serialization boundary, the website must recheck the actor's
linked identity, current fresh membership/eligibility, exact publication binding,
publication state, signup revision, lock/deadline and capacity. Two different concurrent
members cannot take the same final slot. Withdrawal and waiting-list promotion use the
same authoritative rules. A preflight response is never a reservation or permission to
skip these checks. These are companion-website requirements, not bot-side DB guarantees.

Committed result:
`{schemaVersion:1,command:<exact request>,status:"committed",participation,revision,committedAt}`.
`committedAt` is UTC RFC3339; `revision` identifies the resulting signup aggregate.
Join permits only `joined|waitlisted`; Withdraw permits only `withdrawn|none`.
Only this validated committed result produces a translated success/waitlist reply.

Rejected result:
`{schemaVersion:1,command:<exact request>,status:"rejected",reason}` where reason is
`unlinked|ineligible|obsolete|closed|locked|stale_revision|idempotency_conflict`.
Expected domain rejections use HTTP 200 with this strict body. Authentication/protocol
failures may use non-200 but cannot become a committed result. No provider prose is
reflected into Discord. Changed source identity, unexpected fields or wrong action/outcome
are rejected even if the response is otherwise syntactically valid.

## Unknown outcomes and independent acceptance

HTTP 202, redirect, 429, 5xx, lost response, timeout or invalid response after a mutation
attempt is **unknown**, never success. The client does not retry. The private reply
instructs the member to inspect My participation/the website before another change.
A failed final Discord reply does not resend the website command or change its durable
website result. Read-only context/feed/snapshot failures are unavailable, never a
fabricated departure, empty roster, successful publication or eligibility grant.

`tests/website.test.ts`, `tests/signup.test.ts` and `tests/signup-http.test.ts` exercise
the actual client/handler, real loopback HTTP and an independently calculated HMAC.
They cover request/actor/message binding, separate purposes, finite transport, redirect
refusal, strict parsing, membership changes, CS/EN copy, waitlist/withdraw, synthetic
canonical duplicate receipts and lost responses. Fixture duplicate receipt logic is an
illustration of the required website behavior, not an independent implementation audit.

Before activation, prove the independent website against these exact fixtures and
replay/signature vectors; test concurrent capacity, locks, deadlines, unlink/revocation,
draft/retraction/translation privacy, atomic idempotency, callback failure and restart
recovery. Then perform authorized test-guild acceptance with captioned CS/EN screenshots
of real message controls and ephemeral replies. Keep those gates separate from local
simulation, and keep both feature switches disabled until the necessary acceptance and
credentials are explicitly provisioned.

The extension evidence runner, `pnpm exec tsx scripts/extensions-lab.ts`, requires
`LAB_DATABASE_URL` accepted by the existing disposable-database safety guard. It creates
and removes a unique schema, runs the actual publication store/service/transport and
signup handler/client, and writes `.local/lab/extensions-report.json` atomically. It
invalidates any previous successful report before a new attempt. The report records
the source revision/dirty state, real serialized publication payloads, private handler
responses and per-scenario assertions. Website and Discord endpoints are loopback
fixtures; the signup response capture is an InteractionPort observation, not proof of
native Discord rendering. Test-only `loopbackOrigin` keeps public URLs canonical while
routing transport to literal loopback HTTP; runtime configuration never supplies it.
`tests/e2e/extensions.test.ts` requires each named story and every recorded check to
pass, without overwriting the report produced by the CLI.
