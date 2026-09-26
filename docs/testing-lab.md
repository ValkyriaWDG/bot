# Local testing lab

The lab exercises the bot through a simulated Discord interaction boundary, real local
PostgreSQL persistence and loopback HTTP provider fixtures. Its browser viewer displays
sanitized recorded responses and test outcomes. It makes no live Discord registration,
real game-server request or production website claim.

Before running commands, read the checked-out `package.json` and implementations. A
documented command or checked box is not evidence that a run has already passed. Actual
results belong in the report and PR.

## Boundaries and evidence

| Layer                | Lab behavior                                                              | What it establishes                                                                                       |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Discord input/output | Real discord.js interactions and local REST fixture with synthetic actors | Adapter serialization, dispatcher replies, requested private acknowledgement and confirmation transitions |
| Application service  | Actual operations and authorization logic                                 | Capability checks, actor/guild ownership and result handling through the tested scenarios                 |
| Database             | Dedicated disposable loopback PostgreSQL                                  | Actual persistence/transactions for the paths exercised                                                   |
| Wardogs transport    | Local HTTP fixture using the real adapter                                 | Wire serialization, parsing and chosen failure/unknown-response paths                                     |
| Role delivery        | Local signed delivery fixture where exercised                             | Sender behavior against that fixture, not acceptance by the independent website                           |
| Browser              | Local report viewer in Playwright                                         | The viewer's rendered synthetic transcript, locale text and tested layout/controls                        |

The simulated acknowledgement records the bot's requested ephemeral flag and actual local
Discord REST serialization. The fixture raises its client request limit for the scenario
burst; this is not Discord rate-limit acceptance. The lab cannot prove
Discord's actual privacy, installation permissions, Gateway events or native client layout.
A local HTTP fixture cannot prove compatibility with an installed Wardogs game build.
The website receiver fixture keeps replay/order state in its own process; its checks do
not prove a durable independently implemented website receiver.
Keep those separate criteria in [live acceptance](live-acceptance.md).

## Prerequisites

- Use the repository's committed Node/pnpm versions and install with
  `pnpm install --frozen-lockfile`.
- Supply `LAB_DATABASE_URL` for a dedicated disposable PostgreSQL database reachable
  through loopback. The lab validates the target before opening a DB pool or fixture listener.
  Do not reuse `DATABASE_URL`, the website database or an existing operator database.
- The lab creates and removes its own fixture schema. Verify the selected disposable
  database name and owner before running; do not publish private connection strings.
- Install the browser required by the committed Playwright configuration using its
  documented local setup. No bot token, provider credential or website signing secret from
  production is required. Fixtures provide synthetic values.

The accepted URL schemes are `postgres:` and `postgresql:`, with database name exactly
`valkyria_bot_test` or `valkyria_bot_lab`, no query string or fragment, and host
`127.0.0.1`, `localhost` or `[::1]`. A nonloopback host requires both `CI=true` and
`LAB_ALLOW_NON_LOOPBACK=true` for a deliberately isolated CI service; these switches do
not authorize use of an existing application database. Standard repository CI uses loopback.
Each run creates, migrates and finally drops a random `lab_...` schema. It does not truncate
existing tables. The DB role needs schema creation privileges in this disposable database.

The [disposable database guide](lab-database.md) supplies the repository's exact Compose,
PowerShell and shell setup commands. Its public synthetic credentials belong only to that
local fixture. Use it instead of inventing a target or borrowing operator configuration.

Environment variables must be supplied explicitly. The normal runtime does not automatically
load `.env`; do not assume package scripts or the lab read it implicitly. Use the approved
process-secret mechanism for the local database URL and keep it out of shell transcripts.

## Run a report and inspect the viewer

To generate a report and inspect it manually:

```sh
pnpm lab:run
pnpm lab:serve
```

`lab:run` replaces `.local/lab/report.json` with an empty `executionStatus: running` record
before validating configuration or starting a scenario. A complete engine result replaces
it with `executionStatus: completed`; a setup/execution exception replaces it with
`executionStatus: failed`. Completed execution can still contain failed scenarios and
exits nonzero if any scenario failed. A failed new attempt therefore does not leave a
previous green CLI report as its result. Preserve useful prior failure evidence before reruns.

The completed report includes `schemaVersion`, `evidenceKind: simulated-discord`,
`generatedAt`, exact `sourceRevision`, `sourceDirty`, environment descriptions, per-scenario
messages/checks/observations and summary counts. Compare these with the checkout and actual
exit status. File existence or an old browser tab alone does not establish a passing run.

`lab:serve` serves the sanitized latest report at `http://127.0.0.1:4178` by default.
`LAB_PORT` overrides the manual viewer port; `LAB_REPORT_FILE` selects a different report
file for the viewer only. Open the exact loopback URL printed by the CLI.
Keep its bind address private; do not expose the viewer
through a public port or tunnel for screenshots. The viewer must show its simulation label
and source/report context. Its report is evidence, not an interactive connection to Discord.
Search scenario titles/IDs on desktop, then use Tab and Enter to select the native scenario
button. On narrow screens use the Scenario selector. A URL such as `/#unknown-outcome`
opens that recorded scenario. Displayed confirmation labels are transcript state, not live
controls that can execute an operation. Reload after generating a new report.

## End-to-end and browser checks

```sh
pnpm test:e2e
pnpm test:visual
```

`test:e2e` uses the same `LAB_DATABASE_URL` guard and runs the real PostgreSQL/HTTP chain
independently. It validates returned reports in memory and does not publish the canonical
report or screenshots; optional reporter output such as JUnit is separate. `lab:run` is
the sole publisher of `.local/lab/report.json`, with running/failed state handling.
The E2E suite asserts the exact 21 scenario IDs and all their checks, then separately
injects rejected final Discord replies and asserts that a normal journey is marked failed.
This regression prevents missing replies from becoming a false green result. These tests
are separate from unit tests and the existing `TEST_DATABASE_URL` integration suite.

`test:visual` uses Playwright Chromium to inspect the local viewer and save selected captures
under `.local/lab/screenshots`. It starts its own viewer on `127.0.0.1:4178` and does not
reuse an existing server. Stop a manual viewer first. Generate the report with `lab:run`
before running visual tests; the visual command does not itself execute the application
chain. Leave `LAB_REPORT_FILE` unset for the standard current-report workflow.

The Playwright HTML report is `.local/lab/playwright-report`; failure artifacts and retained
traces use `.local/lab/playwright-results`. Verify the report source is current before capturing.
Inspect every selected image for readable Czech accents, English selection, truncation,
confirmation/outcome context and the visible simulation label. A screenshot alone does not
prove transaction races or no-retry behavior; pair it with the scenario assertions.

The implemented scenario groups are:

| Scenario IDs                                                                                          | Assertions exercised                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `help-cs`, `help-en`, `status`, `players`                                                             | Locale replies, real adapter reads, escaped names and omitted platform IDs                                                            |
| `broadcast-confirm`, `kick-confirm`, `ban-confirm`, `unban-confirm`, `map-confirm`, `restart-confirm` | Saved previews without writes; exact single HTTP mutation, durable claim/audit and accepted-result response                           |
| `cancel-expiry`, `authorization-denied`, `role-revoked`, `double-confirm`                             | Cancel/expiry, wrong actor/guild, REST/role denial, fresh role revocation and concurrent PostgreSQL claim                             |
| `unknown-outcome`, `read-error`, `audit-failure`                                                      | Lost response/HTTP 202 remain unknown without retry, safe read errors and a real PostgreSQL audit-trigger failure preventing dispatch |
| `role-sync`, `restart-recovery`                                                                       | Account pending/outbox, signed present/departure/replay/stale fixture checks, persisted interrupted-intent recovery without replay    |
| `defer-failure`, `reply-cleanup-failure`                                                              | Rejected initial acknowledgement stops downstream IO; rejected final reply or source-button cleanup preserves one durable effect      |

Every normal interaction must deliver its final reply successfully. Named delivery-failure
scenarios declare the expected rejection and display a system failure note, not a fabricated
bot response. Recovery here creates a new store instance over saved state; it is not a
process crash/restart or Discord Gateway reconnection test. The player fixture contains two
players; first-20 truncation has separate dispatcher tests rather than 21-player lab proof.

The three Playwright tests cover real report filtering and keyboard selection without
external requests, text-only hostile input and assertion-derived failure badges, then six
full-page captures with no horizontal overflow:

| Screenshot                 | Scenario          | Reply language | Viewport    |
| -------------------------- | ----------------- | -------------- | ----------- |
| `01-overview.png`          | `status`          | English        | 1440 × 1000 |
| `02-confirmed-restart.png` | `restart-confirm` | Czech          | 1440 × 1100 |
| `03-role-revoked.png`      | `role-revoked`    | Czech          | 1440 × 1100 |
| `04-unknown-outcome.png`   | `unknown-outcome` | English        | 1440 × 1100 |
| `05-role-sync.png`         | `role-sync`       | English        | 1440 × 1100 |
| `06-english-mobile.png`    | `help-en`         | English        | 390 × 844   |

Capture metadata is saved in `.local/lab/captures.json`, including browser/platform,
viewport, report/image hashes, captions and separate source/viewer revision/dirty flags.
Viewport height is the browser viewport; full-page PNG height can be greater.

## Review and publish synthetic evidence

1. Complete the source change and its checks, then commit the source through the authorized
   repository workflow. Generate both report and captures from that same **clean source
   commit**. Diagnostic dirty-worktree runs remain valid labeled diagnostics, but the
   curated gallery requires `sourceDirty=false`, `viewerDirty=false` and matching revisions.
2. Run `pnpm lab:run`, then `pnpm test:visual`. Inspect all six images, responses and
   checks; do not edit source between the source run and capture. A later `lab:run` replaces
   the report, so recapture if the report hash changed.
3. Run `pnpm lab:curate` to copy the original report and hashed captures into `docs/evidence/`.
   It writes `report.json`, `manifest.json` and the named PNGs, without generating or editing
   imagery. Captions include **Synthetic Discord lab — local viewer, not Discord**.
4. Inspect public-safe content and captions, then run `pnpm check:evidence`. This checks
   report/capture hashes, PNG dimensions, scenario checks, captions, clean source/viewer
   identity and source revision format. It does not require the historical source commit to
   remain locally available after a squash, and does not claim current CI or
   visually inspect the images for you. Do not relabel dirty captures as clean.
5. Commit only the curated documentation proof separately from the source commit. The
   gallery retains its actual tested source revision; the evidence commit is not retroactive
   source-run provenance. Keep current-revision CI proof separate from this dated gallery.
6. Attach/embed selected evidence in the PR and related issue, with links to
   the exact report/test run. Use commit-pinned links for committed files. `.local/` paths
   alone are not delivered GitHub evidence.

Synthetic screenshots are valid proof of this local simulation and viewer. They do not
substitute for a required live Discord capture. A scoped lab task may be completed with
its own full evidence while the broader [live acceptance](live-acceptance.md) stays open.
Follow [the evidence policy](engineering/evidence.md) for closure and durable delivery.

CI's simulation job reruns E2E, the public lab CLI and visual checks for its tested revision.
It uploads `simulation-proof-<sha>-<attempt>` with the report, screenshots/capture metadata,
Playwright HTML/failure traces and E2E JUnit output, retained for 14 days. Its existence does
not establish a pass; inspect the job and each test result. The quality gate requires
application, container and simulation jobs. Do not use the curated historical gallery as
a replacement for current-head or tested-merge-revision CI evidence.

## Failure and cleanup

If database validation or connection fails, stop the lab and correct the disposable target;
do not fall back to the normal runtime's database. If a scenario fails, preserve its report
and investigate before rerunning. If the viewer is empty, compare report path/schema/run
identity and the CLI's output rather than fabricating a transcript manually.

Stop the local viewer when finished. The `.local/lab` directory is ignored working evidence;
remove or overwrite it only after preserving any useful failure evidence and verifying the
resolved path. The curated `docs/evidence/` set remains a review artifact outside runtime
assets. See [troubleshooting](troubleshooting.md) for user and operator failures.
