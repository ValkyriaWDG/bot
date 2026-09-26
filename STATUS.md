# Implementation status

## Delivered for review

The first bot implementation provides the Discord command surface, fresh role-based
capability checks, PostgreSQL action confirmations/audit, a bounded Wardogs HTTP client,
role synchronization sender, health/runtime lifecycle and offline tooling. Code, docs
and agent procedures are English; Discord command names are English and default copy
is Czech. See [the README](README.md) for concrete commands.

The local simulation lab now drives the production Discord interaction port and
command handlers through actual loopback REST requests, durable PostgreSQL state,
the Wardogs HTTP adapter and a signed role-event receiver fixture. Its 21 scenarios
have per-check evidence and actual recorded responses. A read-only browser viewer
includes desktop/mobile captures, searchable scenarios and truthful simulation labels.
See [the lab guide](docs/testing-lab.md) and [documentation index](docs/index.md).

The service is independent of the website. Its role-sync wire contract is proposed,
not a claim that the separately developed website receiver already supports it.

## Website extensions: bot-side implementation

Issues #11/#12 add private management, canonical website-event ingestion, durable
match/result delivery, signup interaction bridging and truthful server-status boards.
Every extension is disabled unless explicitly configured. Management uses independent
service scopes plus fresh Discord role grants; settings update the actual command
locale/server labels and persist separate desired/effective revisions.

The [website handoff](docs/handoffs/website-extensions.md) defines the remaining web
admin UI, backend management client, publication feed and canonical signup endpoints.
The bot does not issue SSO sessions or duplicate the website roster. Source modules,
local HTTP/DB fixtures and browser proof are distinct from real test-guild acceptance.
See [the extension runbook](docs/extensions-operations.md) for activation and recovery.

Extension verification on 2026-09-26: 229 unit/transport/runtime tests, 40 real PostgreSQL
tests, three application-chain E2E tests and five Chromium checks passed locally.
The original lab has 21 passing scenarios; the extension lab has 14 passing scenarios
covering actual serialized CS/EN publications and private participation responses.
Format, lint, typecheck, build, repository checks and 13 presskit integrity tests passed.
Management proof includes role-delivery aggregates without member data, runtime settings
application/restart, stale roles, concurrent updates and rollback after timed-out audit.
See [extension evidence reproduction](docs/testing-extensions.md). Clean-source image
provenance and current-head hosted container/CI outcomes are recorded with delivery;
these local results do not establish deployed interoperability or a production rollout.

## Evidence boundary

Local behavioral verification uses synthetic Discord interactions and actual local
HTTP fixtures. PostgreSQL tests use a disposable local PostgreSQL 18.4 instance.
The PR records exact commands, current revision and GitHub CI artifacts. A transcript
is not a screenshot of Discord or proof of a live game operation.

Bootstrap verification on 2026-09-26: 137 unit/transport/CLI/runtime tests and seven
real PostgreSQL integration tests passed. Typecheck, lint, formatting, build, repository
checks, synthetic demo, registration dry run and Compose template validation passed.
The production dependency audit reported no known vulnerabilities at that time. These
results are a dated observation; current-head CI remains the delivery gate.

The subsequent simulation delivery adds tests for the extracted production port and
local viewer server, application-chain E2E and Chromium UI verification. The E2E suite
also injects a rejected normal Discord reply and requires the affected scenario to
fail, preventing successful-looking transcripts from masking delivery errors.
CI runs application/PostgreSQL, container smoke and simulation/browser jobs under
one required Quality gate; its artifacts include JUnit, report JSON and browser captures.

The [curated screenshot gallery](docs/evidence/README.md) records the exact clean source and
viewer revision, browser/platform, captions and SHA-256 hashes. Their source commit
precedes the separate evidence commit; they are dated proof, not a claim about later
code. Fresh CI artifacts identify their own tested revision. The fictional website
consumer checks signatures/replay locally and does not implement the actual website.

Simulation acceptance on 2026-09-26: 142 unit/transport/CLI/runtime tests, seven real
PostgreSQL integration tests, two E2E tests and three Chromium tests passed locally.
The 21-scenario report and six screenshots were generated from clean source
`4928473f32657bb5a54cda5b9dc81d3ea4eb6f69`; their exact hashes are in the gallery manifest.

Local Docker execution is unavailable because the Docker daemon is not running.
The GitHub Actions container build and offline health smoke test provide that gate.
Check the linked PR/run result before treating it as passed.

## Press-kit presentation references

Four unmodified owner-provided Wardogs press-kit images have a bounded catalog and
[offline presentation examples](docs/assets/presskit.md). The local preview is an
asset catalog and proposal, not Discord or an implemented bot embed. Czech/English
help examples and UNKNOWN/STALE status examples keep text separate from generic
game imagery. The current command handlers, authorization, confirmations and role
synchronization are unchanged. Public status boards and actual graphical command
integration remain separate work. The [captured review](docs/assets/evidence/presskit-2026-01/README.md)
records desktop/narrow rendering, all four CS/EN fixtures at both sizes and source
fingerprints. All 13 presskit integrity tests pass; current-head hosted checks belong
in the PR. These assets are not yet packaged into the bot image or uploaded to Discord.

## Deferred operator acceptance

- Create/install the Discord application, supply secrets and target guild/role IDs.
- Verify actual Czech/English rendering, role revocation and confirmation behavior;
  attach captioned screenshots before closing the live acceptance issue.
- Confirm the Wardogs wire contract against the installed test-server version,
  including accepted versus unknown outcomes and effect verification.
- Implement/verify the website receiver, event freshness, replay/order rules and key rotation.
- Select a source license; configure registry, production database and deployment
  separately. Image publication and deployment have not been performed.

Use [live acceptance](docs/live-acceptance.md), [operations](docs/operations.md) and
[the roadmap](docs/roadmap.md) to continue. Do not close these gates based on fixture tests.
