---
name: valkyria-database
description: Change Valkyria PostgreSQL schemas and persistence with real transaction tests, migration integrity and compatible upgrade planning.
---

# Database changes

Read [the database workflow](../../../docs/engineering/service-workflows.md#postgresql-and-migrations),
[store](../../../src/persistence/store.ts), [migration runner](../../../src/persistence/migrations.ts)
and [integration tests](../../../tests/integration/store.test.ts).

1. Identify affected invariants, deployed schema/runtime compatibility and the actual
   database target. Never assume a connection is disposable because its variable says TEST.
2. Add a new numbered migration; preserve applied checksums. Keep parameterized queries,
   intent/audit atomicity, per-server serialization, runtime lease and outbox lease ownership.
3. Write a failing real PostgreSQL test for the changed constraint, race or transition.
   Use verified disposable `TEST_DATABASE_URL`; these tests truncate fixture tables.
   No SQLite or in-memory substitute proves PostgreSQL locking.
4. Prove clean install and upgrade from the supported old schema. For breaking changes,
   expand/backfill/switch first and contract only after old runtime rollback compatibility
   is no longer required. Preserve monotonic event ordering across restart and plan restore
   reconciliation without resetting a consumer's replay guard.
5. Run `pnpm test:integration` and applicable checks. `pnpm test` excludes integration tests.
   Prepare migration order and tested backup/restore assumptions for release; execute
   `pnpm db:migrate` only against the target authorized for that task.

Without a disposable DB, continue SQL review, fixtures and independent implementation,
but mark real DB proof blocked. Never enable automatic production migrations or claim
safe deployment from an unexecuted upgrade test.
