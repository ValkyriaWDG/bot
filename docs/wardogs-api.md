# Wardogs HTTP adapter

`src/wardogs/client.ts` implements `GameServer` for the bounded first release:
status, players, broadcast, kick, permanent ban, unban, map change and **match**
restart. `RconError` exposes a safe `code`, `outcome` (`failed` or `unknown`) and
optional `retryAfterSeconds`. It never includes credentials, target URLs, upstream
error text or raw response payloads.

## Source evidence

Inspected on 2026-09-26, using only the public official static console. No game
server was contacted and no credential was supplied during research. The console
host responded over HTTP; HTTPS timed out. Downloaded source was inspected as data,
never executed, and is excluded from Git under `.local/research/`.

| Primary source                                                                                                   | Evidence                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Official HTTP client](http://rcon.wardogs.com/js/api.js)                                                        | Actual method, endpoint, request body and consumed response fields; 17,994 bytes; Last-Modified 2026-09-14 11:50:40 GMT. SHA-256 `d23e81747a18838b763920b669b8944681dc60c8311896e7a444677bd007154c`. |
| [Official console interface](http://rcon.wardogs.com/app.html) and [handlers](http://rcon.wardogs.com/js/app.js) | Match restart semantics, permanent-ban confirmation, missing-platform-identity handling and 200-character broadcast input.                                                                           |
| [Official configuration example](http://rcon.wardogs.com/ServerSettings.ini)                                     | Listener configuration and rotation representation. SHA-256 `a2a660fc042e333debee7418166b4d38272ed71f98db46af2f2779424c9976b4`.                                                                      |
| [Official demo adapter](http://rcon.wardogs.com/js/mock-server.js)                                               | Demonstration behavior only. SHA-256 `969f74e5b003ed552650952ebea680a1982b6b58e32cd9191c1e98a17928cb36`.                                                                                             |

The demo adapter exposes normalized UI objects; it is not a mock HTTP server.
For example, its flat `playerCount` and `scoreTick` differ from the actual HTTP
client's nested `players.current` and `scoreTick.current`. Tests use independently
written synthetic wire fixtures based on the actual client, without copied source.

## Implemented wire contract

Every request sends `Authorization: Bearer <password>`. There is no separate login
request. Bodies use JSON and `Content-Type: application/json`; commands documented
without a body omit it completely. The same configured credential reads and writes.

| Bot method/action  | Official request                  | Consumed response/body                                                                                                                                                     |
| ------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status()`         | `GET /v1/status`                  | Requires `serverName`, `map`, `players.current`, `players.max`. Optional `matchSeconds` becomes `null` when unavailable.                                                   |
| `players()`        | `GET /v1/players`                 | Requires `players[]` with `name`, `faction`, `kills`, `deaths`, `pingMs`; missing/null `steamId` becomes `null`, verified IDs remain strings. Unknown fields are stripped. |
| Write prerequisite | `GET /v1/capabilities`            | Requires a bounded `routes` string array; refreshed for every action. Route parameter names such as `{id}`, `{steamId}` and `:id` are normalized before comparison.        |
| Broadcast          | `POST /v1/broadcast`              | `{ "message": "..." }`                                                                                                                                                     |
| Kick               | `POST /v1/players/{steamId}/kick` | `{ "reason": "..." }`                                                                                                                                                      |
| Permanent ban      | `POST /v1/bans`                   | `{ "steamId": "...", "reason": "..." }`                                                                                                                                    |
| Unban              | `DELETE /v1/bans/{steamId}`       | No body.                                                                                                                                                                   |
| Map prerequisite   | `GET /v1/catalog/maps`            | `{ "maps": [{ "id": "...", "displayName": "..." }] }`; selected map must match an observed ID.                                                                             |
| Map change         | `POST /v1/match/map`              | `{ "map": "..." }`; optional modes, lighting and zone alternators are outside this release.                                                                                |
| Match restart      | `POST /v1/match/restart`          | No body. Reloads the current match, not the server process.                                                                                                                |

The minimum schemas above deliberately omit optional scoreboard fields unused by
the bot. Required values are validated without coercion or fabricated defaults.
Player lists are bounded to 1,000 entries. Numeric scores/times are nonnegative safe
integers; names and map identifiers are bounded strings. These are adapter limits,
not claims about the game's maximum player count.

Mutation return schemas are not fully established by the official client. The
adapter accepts an empty successful HTTP response or a valid JSON object without
an explicit error/`ok: false`. This proves acknowledgement at the HTTP boundary,
not independently verified in-game effect. HTTP 202 means accepted for asynchronous
processing and reports `accepted_unverified` with an unknown mutation outcome,
including when its body is empty. Malformed or contradictory success responses also
have an unknown mutation outcome. None of these outcomes triggers an automatic retry.

## Client policy and failure semantics

- Constructor options are `baseUrl`, `token`, optional `timeoutMs` (default 5,000;
  allowed 1–10,000), and `allowInsecureLoopback` (default false). URLs must be HTTPS
  origins without credentials, paths, queries or fragments. Explicit local tests may
  use only literal `http://127.0.0.1[:port]` or `http://[::1][:port]`; hostname
  aliases and other HTTP destinations remain rejected. TLS verification stays on.
- The official example says non-loopback listeners need TLS and a password hash,
  while its client hardcodes HTTP. This inconsistency is not resolved by weakening
  the bot's transport. An operator must provide a verified HTTPS endpoint or
  an explicitly approved local tunnel terminating at the permitted loopback origin.
- Every response, including streamed/chunked bodies, is bounded to 1 MiB. The timer
  covers headers and body consumption. Serialized requests are also bounded to
  1 MiB; action-specific limits are substantially smaller.
- Only allowlisted methods and fixed endpoint templates are reachable. No arbitrary
  console, URL, path or JSON body is accepted from Discord. SteamID64 action targets
  must be 17 decimal digits as a string. Missing identity is not resolved by player
  name. Map IDs are 1–128 ASCII letters, digits, underscores or hyphens and must
  also be in the current server catalog.
- Messages and mandatory moderation reasons are 1–200 characters without control
  characters. Broadcast's 200-character limit matches the official browser input;
  the reason bound is this bot's own conservative policy. Neither proves a server
  wire limit.
- There are no automatic read or mutation retries. Redirects are refused without
  forwarding credentials. HTTP 429 exposes a parsed Retry-After value bounded to
  24 hours for the caller's scheduling policy; it does not initiate a retry.
- Validation, unsupported capabilities, unknown maps, failed prerequisite reads,
  and explicit HTTP 4xx rejections report `failed`. Mutation network failure,
  timeout, oversized/malformed acknowledgement, redirect or HTTP 5xx report
  `unknown`: the server may have applied the action before the response failed.
  Read failures report `failed`. The surrounding durable action service must keep
  unknown outcomes for operator reconciliation instead of resending the action.

This module does not authorize actors or manage global concurrency. The command
service must enforce fresh role checks, configured per-server grants, one-use
confirmation, durable audit and a bounded per-server execution queue before calling
`execute`. The map/catalog and capability reads do not form a transaction with the
subsequent mutation; the server may still reject a changed capability or map.

## Known routes outside the first release

The source also constructs `GET /v1/rotation`, `GET /v1/bans`, catalog lightings and
experiences routes, `POST /v1/match/end`, `PUT /v1/world/lighting`, player messages,
kill/team changes, audit, sponsor, reserved-slot and config-document routes. They
are not exposed by this bot.

Current rotation edits and setting the next map use `GET /v1/config` followed by
`PUT /v1/config` with raw INI text, `Content-Type: text/plain` and a quoted `If-Match`
revision. The official adapter edits `RotationEntries` under
`/Script/WDGame.WDServerMapRotationSettings`. HTTP 412 is a revision conflict.
The HTML still mentions a separate Save Rotation operation, but the current client
constructs config-document writes. No dedicated rotation-write or process-restart
endpoint is assumed or implemented.

No primary static source inspected here establishes numeric per-IP rate/body caps,
an exact complete capabilities document, temporary bans, automatic retry safety,
idempotency keys or a historical match API. Community numbers must not be promoted
to verified server limits. Official UI polling defaults and mock features do not
establish server guarantees.

## Verification boundary

`pnpm exec vitest run tests/wardogs.test.ts` runs actual HTTP fixtures on ephemeral
loopback ports. It proves bearer headers, paths/bodies, capability/catalog checks,
safe input validation, schema rejection, size/timeout limits, non-forwarded
redirects, 429 handling and unknown outcomes without mutation retry. Fixtures and
their tokens are synthetic. Live Wardogs compatibility and in-game effects remain
unrun until separately authorized server acceptance.
