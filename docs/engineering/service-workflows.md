# Service implementation workflows

Start from [the design](../design.md) and [shared contracts](../../src/contracts.ts).
Keep authorization, persistence, provider transport and Discord presentation separate.
Use [verification](verification.md) for commands and [evidence](evidence.md) for delivery.

## Discord presentation

Read [commands](../commands.md), [the manifest](../../src/discord/commands.ts),
[dispatcher](../../src/discord/handler.ts) and [tests](../../tests/discord.test.ts).

1. Define the user's observable command, option and error states in Czech and English.
   Keep command/option identifiers English and replies Czech by default. English replies
   require the documented explicit selection; Discord client locale is not an implicit override.
2. Build only allowlisted commands/targets. Defer ephemerally before external IO, suppress
   mentions, escape untrusted labels and bound output. The player view omits platform IDs.
3. Route through the operations service. Preview stores the exact action; button IDs carry
   only an opaque intent reference and locale. Actor/guild and fresh-role checks belong to
   the service. UI cleanup must not grant permission, execute twice or erase another user's
   valid controls after a rejected click.
4. Prove unknown input, foreign guild, acknowledgement failure, Czech/English responses,
   output injection, cancellation and success/failed/unknown presentation through the
   narrow interaction port. Reserve actual ephemeral rendering/screenshots for the live gate.

## Wardogs provider transport

Read [wire evidence](../wardogs-api.md), [client](../../src/wardogs/client.ts) and
[transport tests](../../tests/wardogs.test.ts). Verify new endpoints against current
official source before implementing them; a demo object is not a wire response contract.

- Specify method, path, authorization, body and response shape; use synthetic independent
  fixtures. Preserve nullable/absent provider fields instead of inventing values.
- Keep URLs operator-configured. Do not accept an arbitrary host, path or console command
  from Discord. Production configuration uses HTTPS; loopback HTTP is an explicit fixture
  option, not permission to send credentials to a live HTTP service.
- Bound timeout/body size and reject credential-forwarding redirects. Inspect real local
  HTTP request bytes, malformed responses, 429, timeout and no-retry mutation behavior.
- Distinguish an explicit rejection from an unknown outcome after dispatch. Never promote
  a network timeout to success or retry a game mutation automatically. Match restart is
  not machine restart; map/ban/broadcast semantics follow the provider contract.

## Membership, capabilities and website events

Read [operations](../../src/operations.ts), [operation tests](../../tests/operations.test.ts),
[role-sync proposal](../web-integration.md), [service](../../src/rolesync/service.ts),
[signing](../../src/rolesync/signing.ts) and [tests](../../tests/rolesync.test.ts).

- Authorize configured guild/server/capability from current REST membership using role
  IDs. Command visibility, Administrator, local cache and role display names are not grants.
  Failed/unknown lookup fails closed; only authoritative absence represents departure.
- Test role removal between preview and confirm, stale/wrong-user observations, disabled
  writes and audit failure. Every mutation reaches the provider only after fresh checks
  and an atomic persisted claim; user-controlled action parameters never return through a button.
- Treat the website as an independent consumer. The bot cannot create sessions or grant
  website permissions. Keep `roleSync.enabled=false` until both implementations agree on
  the documented transport and pass shared fixtures plus authorized live acceptance.
- Signature verification alone does not prove replay protection or grant freshness. Preserve
  immutable event ID/body/sequence/observation time across retries; regenerate only the
  delivery envelope. The consumer must enforce durable replay/order rules before acknowledgement.
- Test departure racing an in-flight refresh, late results after timeout, out-of-order
  deliveries, terminal errors, bounded retries and rate-limit cooldown. Never fabricate empty
  roles on a timeout or rewrite observation time when sending an old event.

## PostgreSQL and migrations

Read [store](../../src/persistence/store.ts), [migration runner](../../src/persistence/migrations.ts),
[initial schema](../../migrations/001_initial.sql) and [real DB tests](../../tests/integration/store.test.ts).

1. Identify affected invariants and old/new runtime compatibility. Add a new numbered SQL
   migration; do not edit an applied migration whose checksum is already recorded. Review
   constraints, indexes, locking, transaction scope and failure behavior before execution.
2. Preserve atomic intent/audit creation and claim, actor/guild binding, expiry, per-server
   conflicting-action exclusion and restart recovery to `unknown`. Respect the single-runtime
   lease; do not recover another active process's actions.
3. Preserve membership/outbox atomicity, monotonic sequences and ownership of delivery
   leases. A stale worker must not acknowledge a newer lease. Database restore or sequence
   rewind needs explicit consumer reconciliation, not resetting replay guards silently.
4. Use a verified disposable PostgreSQL database for `TEST_DATABASE_URL`; integration tests
   truncate their tables. A variable named TEST does not prove the endpoint is disposable.
   Never point it at production or a shared website database. Run real concurrency/restart
   tests; an in-memory store cannot establish PostgreSQL locking behavior.
5. Prove clean install and upgrade from the last supported schema with representative data.
   The suite's repeated migration run checks idempotence, not every historical upgrade.
   Add targeted upgrade/constraint tests when the schema changes.
6. For breaking changes, use expand, backfill, switch and only later contract. Keep the
   previously deployed runtime compatible until its rollback window ends. Prepare a tested
   backup/restore procedure before authorized production migration; do not assume down SQL
   is safe. Missing DB access blocks that proof, not independent code/review work.

The runtime migration command is explicit `pnpm db:migrate` using `DATABASE_URL`.
Do not execute it against an unverified target or add automatic production migrations
to startup. Deployment and real DB access remain subject to the active task's scope.
