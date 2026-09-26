# Operations and setup

Current stage: implementation and offline verification. Bot creation, credentials,
guild registration, live game tests and production setup were deferred by the owner.
This runbook prepares those later tasks; it does not grant authority to perform them.
Continue actions already authorized in the active task without repeating approval requests.

Read [design](design.md), [command contract](commands.md), [Wardogs wire evidence](wardogs-api.md),
[role-sync proposal](web-integration.md) and [live acceptance](live-acceptance.md).
Keep real operator configuration and secrets outside this public repository.

## Local preparation and verification

Use the committed Node/pnpm versions. `package.json` is the current command source.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm demo
pnpm check:repository
pnpm format:check
```

`pnpm test` excludes DB integration. With `TEST_DATABASE_URL` explicitly set to a
verified disposable PostgreSQL database, run `pnpm test:integration`. Its tests truncate
fixture tables; never use production or the website database. Missing DB access is a
blocked check, not an accepted substitute or silent skip.

`pnpm demo` is a synthetic, secret-free story without network calls. For a separate
offline health fixture after building, run:

```sh
node dist/main.js --offline
```

`GET /health/live` returns 200 with mode `offline`; `/health/ready` deliberately returns 503. Stop the fixture with SIGINT/SIGTERM. No Discord, database or provider readiness is
proved. Live readiness checks the running bot/Discord and database connection, not a
complete Wardogs or website integration acceptance.

## Operator configuration

Copy `config/bot.example.json` to an ignored operator file such as `config/bot.json`.
Replace all synthetic IDs and invalid example addresses with verified values from the
authorized target. Do not infer application, guild, role or server IDs from screenshots.
The parser rejects unknown fields, duplicate servers, insecure URLs and unsupported grants.

| Setting                      | Contract                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `BOT_CONFIG_FILE`            | Operator JSON path; default `config/bot.json`                                     |
| `DATABASE_URL`               | Dedicated bot database and restricted database role                               |
| `DISCORD_BOT_TOKEN`          | Application bot token; never an OAuth user token                                  |
| Per-server `tokenEnv`        | Environment name holding that server's Wardogs credential                         |
| `WARDOGS_WRITES_ENABLED`     | `false` initially; only literal `true` enables game writes                        |
| `roleSync.enabled`           | `false` until the independent website receiver is accepted                        |
| `roleSync.secretEnv`         | Environment name for the agreed signing secret; required when delivery is enabled |
| `HEALTH_HOST`, `HEALTH_PORT` | Defaults `127.0.0.1` and `3000`; keep health private                              |

`.env.example` documents names only. The runtime does not automatically load a `.env`
file: supply environment through the process/container secret mechanism or Node's explicit
environment-file support. Do not paste secret values into shell history, public logs or PRs.
The normal runtime requires configured server credentials even when game writes are disabled.

For a local operator-controlled `.env`, Node can load it explicitly; keep it ignored:

```sh
node --env-file=.env --import tsx src/main.ts
```

After building, use `node --env-file=.env dist/main.js`. For a source-checkout migration,
use `node --env-file=.env --import tsx src/cli/migrate.ts` only after verifying the target.
Alternatively export the environment through the approved secret mechanism before running
the package scripts. No command should print the file's contents.

Grant only the role IDs needed for each server capability: `server.status`, `server.players`,
`server.broadcast`, `server.moderate`, `server.control`. Discord Administrator is not an
application grant. Restrict credentials to their intended server and rotate through the
operator's approved secret process. Do not log the parsed configuration object.

Production URLs must use HTTPS without embedded credentials, query strings or redirects.
If the game's native listener is HTTP, the operator must establish and verify an approved
secure transport/proxy first; do not weaken the bot's HTTPS policy or expose its RCON listener.
Loopback HTTP in fixture tests is a separate explicit test facility.

## Later Discord provisioning and registration

In an authorized setup task, create/select the application and record its verified
application and test-guild IDs privately. Use a guild installation with bot and application
command scopes. Do not grant Administrator, Manage Guild or Manage Roles to the bot merely
to run these commands. Start with role delivery disabled; the runtime then requests only
the Guilds intent. Enable the privileged Guild Members intent in the portal and runtime
only when the accepted role-sync task needs member events. No Message Content or Presence
intent is required by the implemented command scope.

Review the complete manifest offline first, using the selected operator config:

```sh
pnpm commands:register
```

This dry run needs no bot token and does not contact Discord. For an explicitly authorized
live registration, supply the token through the secret mechanism and replace both
placeholders with values matching the configuration exactly:

```sh
pnpm commands:register --apply --guild <configured-guild-id> --application <configured-application-id>
```

Argument order is enforced by the current CLI. Bulk registration replaces this application's
entire command list in that guild, including omitted command types. Review the existing
commands and desired manifest before applying; never run registration on normal startup.
After an uncertain result, inspect registered state before retrying.

`/admin` starts with default permissions `0`; configure command visibility for approved
operator roles in Discord's integration settings. Then separately verify the bot's role
capability map. Visibility and successful installation cannot bypass service authorization.

## Database migration and startup

Use a dedicated PostgreSQL database/role, reviewed permissions and restricted connectivity.
Before an upgrade, identify the exact current image/schema, pending migration files and
backup/restore plan. The migrator checks recorded checksums and uses a transaction/lock;
preserve all applied migration files and never modify one in place.

Create a private backup using operator-approved PostgreSQL tooling and a secret-safe
connection profile. Test restoration into a separate disposable database and verify its
schema/data. Record backup identity, restore evidence and retention privately; do not place
database dumps in GitHub. For example, operator-filled PostgreSQL service profiles can
avoid exposing connection passwords in command arguments:

```sh
pg_dump --dbname="service=<approved-source-service>" --format=custom --file=<private-backup-file>
pg_restore --dbname="service=<disposable-restore-service>" --no-owner --no-acl <private-backup-file>
```

These placeholders are not configured targets. Restore changes the chosen database;
verify its disposable identity before using it. Prove clean install and the actual upgrade
from the deployed schema. Expand/backfill/switch before contracting fields still used by
the old runtime. A rolled-back image must remain schema-compatible; do not blindly run
destructive down migrations or restore production data without its own approved recovery plan.

With the authorized target's `DATABASE_URL` supplied, migration and startup are separate:

```sh
pnpm db:migrate
pnpm build
pnpm start
```

For a built production image, use `node dist/cli/migrate.js` as a one-off migration command
and `node dist/main.js` for runtime. Startup does not register commands or apply migrations.
The production image contains compiled runtime code, not pnpm/tsx. With the reviewed Compose
definition and its private `env_file`, run `docker compose --profile maintenance run --rm migrate`
for the explicit migration step; do not try to run development package scripts inside it.
The migration service takes `DATABASE_URL`, `BOT_IMAGE` and `DATABASE_NETWORK_NAME` from
Compose interpolation, not the bot service's `env_file`. Supply those values through the
operator shell or an explicit private `docker compose --env-file <operator-file>` option
before `--profile`; the default project `.env` also supplies interpolation. A custom
`BOT_ENV_FILE` alone does not configure migration. Do not print expanded Compose config
into public evidence because it can contain secrets.
Run only one active bot instance per configured guild/database runtime lease. Startup marks
interrupted `executing` actions unknown; it must never replay them. SIGTERM stops new work,
drains tracked operations within the runtime deadline, releases the lease and closes the DB.
Lease loss is different: the process exits immediately without draining work under a lost
lease. A possibly dispatched action remains unknown and requires reconciliation.

## Private image release and deployment

Follow [release controls](engineering/release.md). The manual `container-publish` workflow
requires the accepted full `expected_sha`, matching main revision and required CI, protected
environment approval and `CONTAINER_PUBLISH_ENABLED=true`. It is disabled initially.
Configure `DOCKERHUB_IMAGE` and registry secrets only in the later publication task, after
proving the target repository is private. Do not infer an image namespace from the source URL.

Record the immutable SHA tag, digest and OCI revision; verify all identify the accepted
commit. Image publication does not authorize or trigger deployment. Deploy a reviewed
digest through the operator's approved service definition, with secrets/config supplied
privately and health reachable only on the intended private network. Container binding
to `0.0.0.0` is internal; do not publish the health port publicly as a convenience.
Keep writes and role delivery disabled until their live acceptance steps are completed.

## Failure and recovery

| Observation                          | Action                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Liveness fails                       | Inspect process/container state and sanitized logs; distinguish crash from network path failure.                                       |
| Readiness 503                        | Check mode, Discord connection, DB connectivity and shutdown state; do not infer provider outage or retry a mutation.                  |
| Authorization unavailable            | Keep private operations denied; verify configured guild and Discord REST access. Do not substitute cached roles.                       |
| Unknown game action                  | Contain further writes, inspect saved intent/audit and actual target state; reconcile before any new action.                           |
| Role delivery failed/quarantined     | Inspect safe error code, signing/receiver contract, rate limits and outbox state; requeue only after correction and authorized review. |
| Lease lost / second runtime rejected | Verify there is one legitimate runtime; do not break the lock or recover another process's live actions.                               |
| Migration mismatch/failure           | Stop rollout; compare preserved history and backup/upgrade evidence. Do not edit checksums to force acceptance.                        |

For unknown outcomes, read action state/audit using authorized DB access and avoid copying
private actor or action details into public issues. Do not mark an intent successful merely
to clear a warning. Failed outbox records need an operator-reviewed recovery procedure;
there is no public Discord command for arbitrary requeue or database repair.

Resolve incidents only after affected-environment recovery and a justified observation
window, with evidence in the incident and PR as applicable. Local health and a prevention
issue alone are insufficient. Use [the evidence policy](engineering/evidence.md) and
[SECURITY.md](../SECURITY.md) for sensitive reports.
