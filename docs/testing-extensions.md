# Extension simulation and proof

Run all ordinary source checks and `pnpm test:integration` with a verified disposable
`TEST_DATABASE_URL`. Management tests use actual signed HTTP requests and PostgreSQL:
scope/role denial, replay, lock contention, timeout rollback, audit failure and
desired/effective settings. Runtime integration proves a saved setting changes the
actual configuration and survives restart. The Gateway readiness/member is synthetic.

For visible match/result/registration/status evidence, configure the same guarded
`LAB_DATABASE_URL` described in [the database guide](lab-database.md), then run:

```sh
pnpm test:e2e
pnpm lab:run
pnpm lab:extensions
pnpm test:visual
pnpm lab:serve
```

Open `http://127.0.0.1:4178/extensions`. The viewer renders serialized production
publication payloads and private signup-handler responses; it is a read-only
presentation approximation, **not Discord**. No buttons trigger external actions.

The extension generator creates and cleans an isolated schema in the disposable
database. It exercises production publication/store/transport and website/signup
modules through actual local HTTP fixtures with independently checked request
signatures. It records 14 scenarios: CS/EN published match and bound controls,
verified/corrected results, stale/unknown server observations, confirmed/reserve/
withdrawn/current participation, unlinked account, revoked member, unknown mutation
and withdrawn publication. Per-scenario checks determine pass/fail; the viewer does
not manufacture successful state from the scenario title.

`tests/website.test.ts`, `tests/signup-http.test.ts` and the management/publication
PostgreSQL suites cover malformed/oversized replies, replay/order, concurrent events,
binding/eligibility changes, create ambiguity, retry limits, safe edits and shutdown.
The fixtures model the required website contracts, not a second production roster.

Reports and screenshots initially remain ignored under `.local/lab/`.
`pnpm lab:extensions` invalidates the previous report when execution starts and
writes a complete report only after executing the scenarios. Each report has source
SHA/dirty state, timestamp, environment boundaries, assertions and serialized output.
Playwright checks text safety, failed-assertion display, keyboard selection, hash
navigation, CS/EN captures and mobile horizontal overflow. It writes image hashes,
viewport sizes, browser/platform, report hash and viewer revision in the capture manifest.

To deliver inspected evidence, first commit source and confirm a clean tree, then
regenerate both labs and run the browser suite. Inspect the five extension captures,
then run `pnpm lab:extensions:curate` and `pnpm check:extensions-evidence`. Commit the
curated report/images/manifest and explanatory captions separately. The checker rejects
dirty source/viewer, mismatched revisions/hashes, failed scenarios, invalid PNG dimensions
and known fixture credential patterns. Manual inspection remains necessary.

CI generates fresh evidence for its own tested SHA; the `simulation-proof-<sha>-<attempt>`
artifact retains reports/screenshots for 14 days. Curated commit-pinned images provide
dated durable evidence; they do not replace current-head checks or actual test-guild
screenshots. The independent website implementation, real Discord permissions/rendering,
real role revocation and game-provider observations remain live acceptance gates.
