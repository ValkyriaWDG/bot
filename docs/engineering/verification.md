# Verification matrix

Read the current `package.json` and implementations before running a command. A declared
script is not evidence that its target exists or succeeds. Record actual output, revision
and environment. Use the committed Node/pnpm versions and `pnpm install --frozen-lockfile`.

| Change or claim                  | Checks                                                                                               | What the result does not prove                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| TypeScript/runtime behavior      | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`                                             | Live Discord, real provider or production health                              |
| Command/locale presentation      | `pnpm exec vitest run tests/discord.test.ts`; inspect offline manifest with `pnpm commands:register` | Actual Discord rendering, command permission setup or successful registration |
| Membership/authorization/actions | `pnpm exec vitest run tests/operations.test.ts tests/rolesync.test.ts`                               | Real role revocation or website consumer acceptance                           |
| Wardogs transport                | `pnpm exec vitest run tests/wardogs.test.ts`                                                         | Compatibility with the installed live game build                              |
| Schema/store/transactions        | `pnpm test:integration` with verified disposable `TEST_DATABASE_URL`                                 | Production migration safety or historical upgrades not specifically tested    |
| Repository/docs/skills           | `pnpm check:repository`, `pnpm format:check`; validate changed skill frontmatter and links           | Good agent decisions or feature acceptance by itself                          |
| Commit delivery                  | `pnpm check:commits` and staged diff review                                                          | Human review or CI acceptance                                                 |
| Synthetic end-to-end story       | `pnpm demo`                                                                                          | Network integration, actual users or live server effects                      |
| Local application-chain lab      | `pnpm lab:run` and `pnpm test:e2e` with a verified disposable loopback `LAB_DATABASE_URL`            | Live Discord, an installed Wardogs build or the independent website receiver  |
| Synthetic viewer presentation    | `pnpm lab:run`, then `pnpm test:visual`; `pnpm lab:serve` is for separate manual inspection          | Discord native rendering, real ephemeral privacy or actual game effects       |
| Curated simulation provenance    | `pnpm lab:curate` after clean-source captures, then `pnpm check:evidence`                            | Current CI, live acceptance, visual quality or historical commit availability |
| Container/health                 | Build image and run the documented offline health smoke check                                        | Live readiness, external dependencies or deployment                           |

Run focused tests while implementing, then all applicable commands for the final diff.
`pnpm test` deliberately excludes `tests/integration/**`, `tests/e2e/**` and
`tests/visual/**`; do not report it as real DB, application-chain or browser coverage.
Missing `TEST_DATABASE_URL` must fail the integration command rather than silently
skip. Those tests destroy their fixture tables, so verify the database's disposable identity.

`pnpm commands:register` is an offline manifest dry run by default and requires no bot
token. Do not append apply flags to a verification command. `pnpm demo` is synthetic and
must not use network credentials. The `start --offline` runtime mode is a health fixture:
liveness 200 and readiness 503 are intentional, not production recovery or readiness.
Use the current runtime CLI syntax from its runbook; do not pass real secrets into offline checks.

## Local simulation and browser evidence

The [testing lab](../testing-lab.md) defines a separate synthetic Discord boundary with real
local PostgreSQL/HTTP application paths. Verify the lab scripts and their implementations
in the checked-out revision before running them. Supply only `LAB_DATABASE_URL` for the
lab's dedicated disposable database, following the [exact guard and CI exception](../testing-lab.md);
never fall
back to the normal bot or website database. Missing or rejected configuration is a failed
or blocked check, not permission to switch to in-memory persistence and retain the same claim.

`lab:run` alone publishes `.local/lab/report.json`; it replaces previous output with running
state and replaces that with a complete scenario report or failed execution state. E2E tests
validate reports in memory and cannot refresh this canonical evidence. Inspect source
revision/time, execution state and per-scenario assertions after the actual run. Distinguish
the real database and loopback HTTP layers from the simulated Discord actor/input/output
and fixture membership/provider responses. Record actual test coverage rather than assuming
that a path displayed in the viewer was exercised through the full application chain.

Playwright captures under `.local/lab/screenshots` are actual screenshots of the local
viewer. They are valid proof of the rendered simulation when labeled and inspected; they
are not live Discord screenshots. Cover Czech/English text and relevant success, denial,
confirmation/cancel and unknown states; include mobile/focus checks when the viewer changes.
Pair images with behavioral assertions for properties screenshots cannot establish, such
as durable one-use claims, role freshness, signatures and no automatic mutation retry.

The E2E suite checks all 21 required scenarios and separately proves rejected final replies
fail a normal journey. The three Playwright tests cover report/keyboard navigation, unsafe
text and assertion-derived failure presentation, plus six captioned desktop/mobile captures.
These are declared checks, not a claim that the current revision passed them. See
[the lab guide](../testing-lab.md) for exact scenario and screenshot mappings.

From the same clean source and viewer revision, run `pnpm lab:curate` to copy public-safe
captures/report into `docs/evidence/` with its manifest and captions; run `pnpm check:evidence`
before staging. Preserve the actual source revision in the later documentation evidence
commit. CI reruns E2E, report generation and browser checks per tested revision; its
`simulation-proof-<sha>-<attempt>` artifact has 14-day retention. The dated gallery and
hash checks do not replace current CI or visual inspection.
Follow [the evidence policy](evidence.md) for source provenance, commit-pinned delivery and
PR/issue summaries. Complete the lab's acceptance independently while retaining the live
gates below. Do not relabel fixture endpoints or synthetic membership as production checks.

Operator runtime configuration uses `BOT_CONFIG_FILE` (default `config/bot.json`),
`DATABASE_URL` and `DISCORD_BOT_TOKEN`. Configured server/signing secrets are resolved
through `tokenEnv` and `secretEnv`; never print their values. Game writes are disabled
unless `WARDOGS_WRITES_ENABLED` is the literal `true`. Role delivery separately uses
`roleSync.enabled`, initially false. Health binds to `127.0.0.1:3000` by default through
`HEALTH_HOST`/`HEALTH_PORT`; a container may bind internally to `0.0.0.0` without making
the port publicly accessible. Do not change network exposure merely to capture evidence.

Only in an explicitly authorized live registration task, the CLI requires all of
`--apply --guild <configuredGuildID> --application <configuredAppID>` plus the bot token.
Review the full offline manifest first: application/guild bulk replacement can delete
commands omitted from it. No token is required for the default dry run.

## Live gates

Bot provisioning, credentials and live guild/game/server testing were deferred by the
owner in the bootstrap task. Continue authorized local implementation, PR and evidence
work, but keep these acceptance items explicitly pending until a later live task supplies
the target and authorization:

- Exact application/guild registration and installation; configured command visibility;
  Czech/English actual responses, ephemeral privacy, button lifecycle and screenshots.
- Fresh role revocation between prepare and confirm, departures and required member intents.
- Dedicated test Wardogs server reads and explicitly approved mutation scenarios; inspect
  actual result and audit, including reconciliation of unknown outcomes without blind retry.
- Independently implemented website receiver, durable replay/order/freshness behavior and
  key rotation. A sender's local signed fixture is not cross-repository integration proof.
- Production DB, image publication and deployment/recovery checks under their separate scopes.

Use [the evidence policy](evidence.md) for captions, artifact delivery and issue closure.
Never describe a blocked visible check as screenshot N/A, or a green previous-head run
as proof of the current PR. Retry checks only after inspecting the failure or making a
relevant change; report environmental failures honestly.

## Behavioral review of skills

Frontmatter/link validation checks packaging only. For a substantive workflow change,
run a fresh agent through a bounded scenario without giving it the intended answer:
accepted SHA differs from current main; role revoked before confirmation; provider timed
out after a write; local screenshot lacks a reviewable URL; DB contraction breaks the old
runtime. Evaluate its concrete actions, evidence requirements and stopping point. Correct
the smallest demonstrated ambiguity instead of adding broad prohibitions.
