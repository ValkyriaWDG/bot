# Private website management API

Version 1 adds authenticated visibility and bounded presentation settings. It does
not register commands, post Discord messages, control game servers, restart processes,
edit role grants, enable role synchronization or create website sessions. Activation
is operator controlled and disabled unless the runtime explicitly constructs and
binds this server. The website implementation and live acceptance remain separate.

## Transport and identity

The website backend calls the bot over an operator-protected private connection.
The Node server is HTTP; bind to loopback/private networking behind authenticated
infrastructure and TLS where traffic crosses hosts. Never expose it through a public
tunnel or contact it directly from browser code. Browser Origin requests are rejected;
no cookies, CORS or browser-held service keys are supported. The website must enforce
its own authenticated session, fresh authorization and CSRF protection before signing.

Use a dedicated management key of 32–256 characters, distinct from Discord, game,
OAuth and role-sync secrets. At most four operator-configured keys support explicit
rotation; each has `bot.read`, `bot.configure`, or both scopes. The operator separately
maps those two capabilities to Discord role IDs. Neither Discord Administrator nor
website role assertions bypass that mapping. Keys, grants and destinations are not
editable through this API.

Every accepted request verifies a fresh Discord REST membership for the signed actor
in the configured guild. Missing, departed, wrong-user and stale observations deny
access. Observations must be no older than 60 seconds and no more than five seconds
in the future. Configure requests repeat this check after acquiring the database row
lock, immediately before storing the change. They additionally require a current
runtime observation (30 seconds), connected Discord, available DB and a held lease.

The service key authenticates the website's actor attestation, not the human's browser
session. A compromised key can impersonate a currently privileged guild member; fresh
Discord roles limit eligible identities but do not prove human intent. Keep keys on
the backend, restrict network access, rotate/revoke compromised keys and audit actor
and correlation IDs. Even that key cannot widen the supported configuration surface.

## Exact signed request

Routes are exact; query strings, encoded alternatives and other methods are rejected.

| Method | Path                          | Required scope  |
| ------ | ----------------------------- | --------------- |
| GET    | `/api/management/v1/status`   | `bot.read`      |
| GET    | `/api/management/v1/settings` | `bot.read`      |
| PATCH  | `/api/management/v1/settings` | `bot.configure` |

Headers use the prefix `X-Valkyria-Management-` followed by `Key-Id`, `Timestamp`,
`Nonce`, `Guild`, `Actor` and `Signature`. Guild/actor IDs remain decimal strings.
Timestamp is Unix seconds, nonce is 16 random bytes in lowercase hex, and signature
is a lowercase HMAC-SHA256 digest. Duplicate management headers are rejected.

Sign the exact UTF-8 bytes below, with LF separators and no trailing LF after body:

```text
VALKYRIA-MANAGEMENT-V1\n<METHOD>\n<PATH>\n<KEY-ID>\n<TIMESTAMP>\n<NONCE>\n<GUILD>\n<ACTOR>\n<RAW-BODY>
```

GET body is the empty string. PATCH requires `application/json` and valid UTF-8;
compressed bodies are unsupported. Use the exported `signManagementRequest` helper
or match the independent vector in `tests/management.test.ts`. A role-event signature
is not interchangeable with this format. Verification accepts timestamps at most
60 seconds old and five seconds ahead. It authenticates the original body before
parsing JSON, binds method/path/actor/guild and verifies key scope.

After signature validation, a durable nonce receipt is committed before authorization
or processing. `(guild, nonce)` is unique across keys. Receipts remain for ten minutes,
covering the complete accepted envelope interval; expired receipts are cleaned during
later requests. Every retry needs a fresh nonce/signature. Replayed requests return
409 and do not reapply changes. A timeout can occur after a desired change commits:
read settings using a fresh request before deciding whether to submit another edit.

## Settings contract

Only these full-replacement settings are accepted:

```json
{
  "expectedRevision": "0",
  "settings": {
    "defaultLocale": "en",
    "serverLabels": { "primary": "Valkyria Wardogs" }
  },
  "reason": "Update presentation language",
  "correlationId": "11111111-1111-4111-8111-111111111111"
}
```

Locale is `cs` or `en`; labels have 1–60 characters and no controls, markup delimiters
or mentions. Supply exactly the configured server IDs, without adding/removing servers.
Reason is required and bounded to 200 printable characters; correlation ID is a UUID.
All unknown fields fail validation, including channels, templates, arbitrary URLs,
secret references, role grants, process commands and enablement flags. Channel/schedule
configuration belongs to its independently authorized publication feature.

Responses to GET/PATCH settings contain `schemaVersion: 1`, `desired`, `effective`
and `applyState`. Each snapshot contains a decimal-string `revision` and `settings`.
`effective` may be null. Apply state is `applied`, `pending`, `error` or `unknown`.
Only a matching actual runtime snapshot proves `applied`; persisting a desired value
does not. PATCH returns 200 when applied and 202 for saved but unapplied settings.
The effective snapshot must match both revision and values, not just callback return.

PostgreSQL locks the guild settings row, checks `expectedRevision`, reauthorizes the
actor and commits the new revision with before/after settings and actor/key/reason/
correlation audit in one transaction. An audit failure rolls back the desired change
and prevents runtime application. Concurrent writers based on the same revision yield
one accepted update and a 409 conflict. Rejected authenticated requests are audited
without raw request bodies, signatures or upstream errors.
The transaction checks the request/runtime fence again after its database writes,
before commit. Expiry or shutdown during a blocked audit insert rolls back both the
desired settings and audit; a response lost during commit still requires reconciliation.

`PostgresManagementStore.initialize()` inserts initial operator presentation defaults
only when no settings row exists. It never runs migrations or overwrites saved settings.
Startup reads `readSettings()` and applies that snapshot under the normal runtime lease.
The injected apply callback should synchronously update locale, server labels and the
effective snapshot atomically; this slice needs no remote operation or process restart.
Keep a monotonic revision guard in the runtime. The HTTP server serializes its own
update/application sequence, and the global runtime lease excludes competing instances.
On callback failure the desired revision remains durable, effective state stays as
reported by the runtime, and a safe error marker survives restart. An actual matching
effective snapshot takes precedence over an old failure marker.

Shutdown calls `closeManagementServer(server)` before releasing the runtime lease or
ending the pool. It stops acceptance, aborts/fences active and queued requests, closes
connections and drains tracked handlers. The default 15-second drain limit must fit
inside the runtime's outer shutdown deadline. A drain timeout is an error, not clean
completion. Runtime application callbacks must check the stopping/lease fence and apply
their in-memory snapshot synchronously; do not schedule detached configuration changes.

## Status contract and limits

Status returns schema version, observation time, allowlisted build version/full revision,
start time, distinct Discord/DB/lease states, desired/effective revisions and application
state. Runtime state is `healthy`, `degraded`, `unknown` or `stale`, using a 30-second
observation bound. Aggregate role-sync data contains enabled state, pending/failed
counts, oldest pending time and last successful delivery time. Disabled synchronization
is `disabled`; no delivery evidence is `unknown`; failures or pending work older than
60 seconds are `degraded`; a last delivery older than five minutes is `stale`.
These states describe observation/delivery freshness, not the game server's health or
successful synchronization of every guild member. No provider probes or game writes
are triggered by this API.

Last delivery time is durable: the role outbox retains its `delivered` row and its
lease-fenced acknowledgement timestamp in `updated_at`. Status aggregates only the
configured guild. Wrong/replayed completion leases do not advance that timestamp;
empty queues without a retained successful delivery remain `unknown`. No new migration
is needed. If a future retention policy deletes delivered rows, first preserve the
per-guild last delivery observation transactionally in separate durable storage.

There are no tokens, secret environment names, private provider URLs, member lists,
role snapshots, connection strings or raw dependency errors in responses. Durable
replay/audit/database failure prevents management access; it does not bypass auth to
return a successful status page. Minimal private health endpoints remain independent.

Bodies are capped at 16 KiB. Default total request deadline is five seconds, configurable
between 100 ms and ten seconds. The service-wide rate limit defaults to 120 requests
per minute, capped at 600, with `Retry-After` on rejection; invalid requests count too.
The limiter is per runtime and resets on restart; durable replay protection does not.
Headers/connections are bounded and responses use `Cache-Control: no-store`.

Errors are code-only: 400 invalid input, 401 signature/expiry, 403 scope/guild/member
denial, 404 unknown route, 409 replay/revision conflict, 413 oversized body, 429 rate
limit, 503 storage/runtime unavailable, and 504 deadline. Late membership results cannot
authorize a mutation after the deadline. The website should show unavailable/pending
states and reconcile uncertain updates rather than automatically resubmitting them.

## Migration, tests and acceptance

Run the explicit migration command before enabling this feature. Migration 002 is
additive; prior runtime tables/checksums are unchanged and an old runtime can still
operate during rollback. Old code does not understand presentation overrides, so
rolling back also reverts effective presentation to its operator file until upgraded.
Do not delete durable replay/audit/settings records or rewind revisions during recovery.

Focused verification uses `pnpm exec vitest run tests/management.test.ts` and
`pnpm exec vitest run tests/integration/management.test.ts` with a verified disposable
`TEST_DATABASE_URL`. PostgreSQL tests isolate themselves in a uniquely named schema.
They cover upgrade from 001 with preserved data, concurrent row locks/revisions,
restart persistence, durable nonce replay, fresh/revoked membership, audit rollback,
sanitized status, actual versus desired application and request bounds. Signature tests
use an independent HMAC vector and tampering/wrong-scope/key-rotation fixtures.

These are local backend/API proofs. No screenshot is required for this endpoint alone;
the companion website admin feature supplies its own Czech/English UI evidence. Actual
private transport, deployed website-to-bot calls, live Discord role removal and operator
key rotation remain separate live acceptance. No tokens or production actions are
required by these local tests.
