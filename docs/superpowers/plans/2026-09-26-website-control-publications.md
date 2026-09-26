# Website control and Discord publications implementation plan

**Goal:** Implement the bot-owned work in issues [#11](https://github.com/ValkyriaWDG/bot/issues/11)
and [#12](https://github.com/ValkyriaWDG/bot/issues/12), with reviewable offline evidence.

**Architecture:** One existing Node service, independent PostgreSQL persistence, a private
authenticated management listener and disabled-by-default publication workers. The website
remains authoritative for OAuth, public content and participation. External boundaries have
strict versioned contracts and loopback fixtures; fixtures do not implement the real website.

**Tech stack:** Existing Node 24, TypeScript, discord.js, pg, Zod, Vitest and Playwright.
No new runtime dependency is required. The written issue specifications were approved by
the owner with the instruction to implement the bot issues. Execute with bounded parallel
module ownership; the coordinator alone owns integration, commits and GitHub delivery.

## Constraints and review focus

- English code/docs; Czech default Discord responses with explicit English support.
- No live registration/messages, production credentials, game writes, merge or deployment.
- Fresh server-side membership and explicit grants; identity/locale never imply authority.
- Separate purpose credentials for management, role sync and publication/participation.
- Unknown external mutation outcome cannot become an automatic retry or success.
- Recheck canonical publication before dispatch; stale events cannot resurrect withdrawn data.
- Persist settings, receipts and delivery transitions with real PostgreSQL transaction proof.
- Desired/effective configuration and stale/unknown status must be truthful after failure/restart.

## Task 1: Private management API

Owned files: `src/management/`, `tests/management*.test.ts`,
`tests/integration/management.test.ts`, `migrations/002_management.sql`,
`docs/management-api.md`.

- [x] Add failing tests for signed request binding, replay, scope, fresh actor authorization,
      secret-safe status and optimistic settings updates.
- [x] Implement the HTTP factory, strict contracts, dedicated keys/scopes and durable
      nonce/config/audit store. Supply typed runtime injection rather than importing main.
- [x] Prove wrong actor/guild, revoked roles, stale assertions, conflicting updates, audit
      failure, application failure and restart recovery against real handlers/database.
- [x] Document the exact wire contract and the companion website implementation boundary.

## Task 2: Durable publication and status workers

Owned files: `src/publications/`, `tests/publications*.test.ts`,
`tests/integration/publications.test.ts`, `migrations/003_publications.sql`,
`docs/publications.md`.

- [x] Add failing behavioral tests for canonical projection validation, ordering, duplicate
      events, unknown creation outcome, corrections/retraction and truthful status rendering.
- [x] Implement renderer, actual Discord transport adapter, persistent binding/delivery
      state and bounded worker. Treat create and update retry semantics separately.
- [x] Prove concurrent delivery/restart transitions and immutable deduplication in PostgreSQL.
- [x] Record actual CS/EN output from production renderers; no synthetic success claims.

## Task 3: Website client and signup bridge

Owned files: `src/website/`, `src/signup/`, `tests/website*.test.ts`,
`tests/signup*.test.ts`, `docs/website-publications-contract.md`.

- [x] Write failing real-loopback transport and interaction-port tests.
- [x] Implement fixed-origin signed versioned requests, bounded responses, safe outcomes and
      early private acknowledgement. Resolve actor by Discord ID, current message binding and
      fresh eligibility; the website owns roster capacity, locks and final transaction outcomes.
- [x] Test hostile buttons, identity/guild mismatch, unavailable membership, missing account
      link, duplicate interaction identity, errors and an ambiguous mutation without retry.
- [x] Publish shared request/response fixtures and required website acceptance separately.

## Task 4: Runtime composition and evidence

Coordinator owns `src/main.ts`, runtime/config/contracts changes, existing interaction port,
CI, integration fixtures/viewer and top-level documentation. Module owners announce their
exports before composition; consumers agree contracts before implementation diverges.

- [x] Test strict disabled-by-default options and startup/shutdown behavior before wiring.
- [x] Integrate management settings into actual default locale/display labels and connect
      publication/signup paths only through explicit operator configuration.
- [x] Run focused tests, typecheck, lint, format, repository/evidence checks, full unit suite,
      real disposable PostgreSQL integration and application-chain/browser smoke.
- [x] Capture public-safe offline feature screenshots from actual recorded outputs and pin
      source hashes/revisions. Live Discord and independent web receiver remain unverified.
- [ ] Review the combined diff, commit, create scoped PR(s), verify exact-head CI and add
      acceptance proof to #11/#12 and relevant website handoff items without closing live gates.

## Baseline

Isolated branch `feat/website-control-publications` starts from presskit PR #10 at
`9cf45713b2dc0253b07c5e99340129ef6da68360`. Frozen dependency installation succeeded;
baseline unit/transport suite passed 142/142. Existing source checkouts were unchanged.

## Implementation verification

Before source commit: 229 unit/transport/runtime tests, 40 PostgreSQL tests, three E2E
tests and five Chromium tests passed. Both labs passed (21 original and 14 extension
scenarios). Review found and fixed listener cancellation, queued shutdown work, late
audit commit and stale signup-controls races; each has executable regression proof.
Independent final module reviews found no remaining actionable P1/P2 within their
bounded scopes. Live Discord, actual website endpoints and deployment remain untested.
