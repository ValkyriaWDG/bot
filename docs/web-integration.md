# Website role synchronization

Status: the bot implements a sender and a **proposed** concrete transport. The website
currently reserves the endpoint and eight JSON fields below. Its independently
developed receiver must adopt and verify this proposal before delivery is enabled.
No shared database, live credential, production request or verified cross-repository
integration is implied by local fixture tests. Keep `roleSync.enabled` false until
both implementations pass the same contract fixtures.

## Ownership and compatibility

The website owns Discord OAuth, the unprefixed `/api/auth/callback/discord`, browser
sessions, local recovery/MFA, role mappings and website capabilities. The bot observes
membership; it cannot grant owner/admin capabilities or create web sessions. `/account`
reports capabilities and can register a tracked user through a fresh membership lookup.
The website link appears in `/help`.
Joining Discord and signing into the website remain separate actions.

The bot uses its own PostgreSQL database, monotonic sequence, membership records and
outbox. The web uses its own sessions, membership projections, replay receipts and
policy versions. Exchange validated messages only. A bot token is server-only; the
current web design also needs a bot token for direct Discord member REST refreshes.
OAuth client secrets and website database credentials do not belong in the bot.

Authoritative source: the website's
[authentication contract](https://github.com/ValkyriaWDG/www/blob/main/docs/security/auth-rbac.md).
That document fixes the field names, string IDs, freshness bounds, replay/order
requirements and recommended HMAC approach. Header names, encoding, acknowledgement
codes and exact signing input here are this bot's proposal, not previously agreed APIs.

## JSON v1

`POST /api/integrations/discord/role-sync`, `Content-Type: application/json`.

| Field               | Proposed representation                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `schemaVersion`     | Integer `1`                                                                |
| `eventId`           | UUID string, stable for every delivery of this immutable event             |
| `guildId`, `userId` | Nonzero decimal snowflake strings, at most 20 digits                       |
| `roleIds`           | Complete unique array of snowflake strings, at most 250 entries            |
| `membershipState`   | `present` or `left`; `left` requires an empty role array                   |
| `observedAt`        | UTC RFC3339 timestamp ending in `Z`; never refreshed by delivery/retry     |
| `sequence`          | Positive decimal string, at most 30 digits; compare with integer precision |

Unknown membership is a failed observation, not a fabricated `left`/empty snapshot.
No `unknown` wire event is produced by v1. The website may retain `unknown` as an
internal access-policy state. Reject unknown JSON fields and schemas. Bodies are
limited to 65,536 UTF-8 bytes. Numeric IDs and duplicate role IDs are invalid.

`saveMembership` commits the observation and immutable outbox event together. The
database allocates a global monotonic sequence, which is also monotonic per member.
Only compare sequences within the configured producer and guild; ordering survives
process restart and signing-key rotation. Gateway session `s` is not this sequence.
Database restore/sequence rewind requires explicit reconciliation with the consumer;
never reset the receiver's ordering guard automatically.

## Signed envelope

Headers:

- `X-Valkyria-Key-Id`: `[A-Za-z0-9_-]{1,64}`, allowlisted by the receiver.
- `X-Valkyria-Timestamp`: Unix seconds encoded as a decimal string.
- `X-Valkyria-Nonce`: 16 cryptographically random bytes encoded as 32 lowercase hex characters.
- `X-Valkyria-Signature`: HMAC-SHA256 digest encoded as 64 lowercase hex characters.

Signing key: at least 32 UTF-8 bytes from an operator secret. Sign exactly these UTF-8
bytes, using LF between the first five values and **no trailing LF** after the body:

```text
POST\n/api/integrations/discord/role-sync\n<keyId>\n<timestamp>\n<nonce>\n<rawBody>
```

The displayed `\n` means byte `0A`, not two literal characters. The sender serializes
the validated fields in the table order. Receiver verification uses the received
bytes before parsing; it must not stringify parsed JSON before verifying. Reject
query strings, URL credentials, fragments and another path. Production transport is
HTTPS with no redirects; loopback HTTP requires an explicit development/test option.

The stateless `verifySignedEvent` helper authenticates the method/path, key, raw body,
timestamp and nonce shape, compares fixed-size digests in constant time, then validates
the JSON/guild. It accepts delivery timestamps within ±300 seconds and rejects an
observation more than five minutes in the future. **It is not a complete receiver**:
successful verification does not check durable replay, sequence, membership freshness
or grant any capability. Old observations can be delivered for invalidation but cannot
be presented as fresh grants.

The consumer must transactionally enforce:

1. Unique `(producer, nonce)` receipts retained at least 15 minutes, covering the full
   timestamp window including allowed future skew. Never apply a repeated nonce.
2. Unique `(producer, eventId)` plus immutable body digest. Retain delivery receipts
   for the operational retry period; seven days is the proposed baseline. Same event
   ID with different content is a conflict, never an accepted duplicate.
3. Per-member last sequence/tombstone, with **no automatic expiry** that would allow
   an older `present` event to resurrect a newer departure. A newer observation and
   policy invalidation commit with the replay record before acknowledgement.
4. Key rotation using an explicit current/previous key allowlist and overlap covering
   in-flight delivery. A key change does not change the logical producer/sequence scope.

## Delivery and errors

The sender keeps event bytes, ID, sequence and `observedAt` stable on retry; it creates
a fresh timestamp/nonce/signature envelope. A timeout may mean the receiver committed:
retry the same event, relying on durable deduplication rather than creating a new one.

- HTTP `200` or `204`: receiver has durably accepted the event; acknowledge the outbox.
- HTTP `409` with JSON `{ "code": "DUPLICATE_EVENT", "eventId": "<same UUID>" }`:
  an identical event was already committed; acknowledge without applying it again.
- HTTP `409` with matching event ID and `code: "STALE_EVENT"`: durable newer sequence
  makes this event obsolete; acknowledge without applying it. Other `409` responses
  retry and eventually fail; response bodies are capped at 4,096 bytes.
- HTTP `429` or `5xx`, network failure/timeout: retry with exponential backoff, capped
  at one hour, but honor a longer valid `Retry-After` seconds/date. A `429` pauses all
  sends through this service instance to that endpoint until the retry time.
- Redirect or other HTTP rejection: persist a failed outbox state. Never follow a
  redirect or treat `401`/`403` as delivered. At eight claimed attempts, retryable
  failure is quarantined through `failOutbox` for operator inspection/requeue.

Run one active bot instance under the database runtime lease. In-process 429 cooldown
does not coordinate multiple independent senders. Failed/rejected delivery never
removes the requirement for web-side REST freshness checks. Code-only error labels
reach the store; transport bodies, signatures, secret values and raw upstream errors
are not logged or surfaced by this module.

## Observations, races and reconciliation

`RoleSyncService(config, store, membershipProvider, options?)` exposes:

- `refresh(userId)`: bounded authoritative REST lookup; verify the configured guild,
  exact user and observation age ≤60 seconds, then persist/outbox. Failed/unknown
  lookup throws a safe code and does not fabricate membership.
- `depart(userId)`: immediately enqueue an empty `left` observation. It increments a
  member generation synchronously so an already-started REST lookup cannot subsequently
  save stale roles. Persistence waits only for an already-running same-member DB write,
  not for REST. Runtime must await/catch this operation and monitor persistence failure.
- `observe(member)`: accepts an already-authoritative validated observation, fences
  outstanding lookups and serializes same-member writes. Runtime normally uses the two
  higher-level methods. Never call it with browser data or an unverified local cache.
- `reconcile()`: process one bounded page of tracked users and advance/reset a cursor;
  return processed/failed counts. Failures leave that member for a later pass. No
  overlapping reconciliation runs; no implicit whole-guild discovery.
- `tick()`: bounded, nonoverlapping delivery, enabled only by `config.enabled`. Claim
  one item at a time so another slow delivery does not consume its lease.

Runtime schedules `reconcile()` using configured `reconcileSeconds` and `tick()` on
its sender interval. Constructor options support injected clock/fetch/nonce for
fixtures, batch size (default 10, maximum 20), request timeout (default 5s, maximum
10s) and explicit loopback HTTP. REST-provider timeout abandons the result; the provider
should also bound/cancel its underlying HTTP request. No late result is persisted.
Disabled delivery can still persist tracked observations; its outbox remains pending,
and account/status replies must not claim successful web synchronization.

Member add/update and account refresh use fresh REST; departure uses `depart` without
waiting for REST. A 403, timeout or unknown guild remains a failure, not zero roles.
Only Discord's explicit unknown-member outcome maps to authoritative departure in
the provider. Honor Discord rate limits, enable the required `GUILD_MEMBERS` intent
for member events, and do not request Administrator merely to observe roles.

The safest compatible web receiver uses events for immediate invalidation/revocation;
**fresh server-side Discord REST authorizes positive grants**. Invalidate a member
generation before lookup and conditionally commit its response only if no newer event
changed that generation. Never compare unrelated REST timestamps to Gateway sequence
numbers. Web privileged writes require observations within 60 seconds; private reads
within five minutes. A fresh signed envelope does not extend those bounds. An outage
must leave public content available while private authorization fails closed.

## Acceptance before enabling

Local tests exercise actual loopback HTTP, immutable retries, HMAC tampering, wrong
guild, timeout, 429 cooldown, redirect rejection, terminal acknowledgement, attempt
exhaustion and departure/REST races. They do not prove a deployed receiver or guild.
Both repositories must next prove durable replay races, key rotation, out-of-order
departure/present delivery, process restart, receiver commit-before-ack, fresh REST
generation fencing and revocation using a supplied test guild. Keep that live work open.

Primary references: [Discord member API](https://docs.discord.com/developers/resources/guild#get-guild-member),
[member events](https://docs.discord.com/developers/events/gateway-events#guild-member-update),
[rate limits](https://docs.discord.com/developers/topics/rate-limits).
