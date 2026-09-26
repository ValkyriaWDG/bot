# Implementation status

## Delivered for review

The first bot implementation provides the Discord command surface, fresh role-based
capability checks, PostgreSQL action confirmations/audit, a bounded Wardogs HTTP client,
role synchronization sender, health/runtime lifecycle and offline tooling. Code, docs
and agent procedures are English; Discord command names are English and default copy
is Czech. See [the README](README.md) for concrete commands.

The service is independent of the website. Its role-sync wire contract is proposed,
not a claim that the separately developed website receiver already supports it.

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

Local Docker execution is unavailable because the Docker daemon is not running.
The GitHub Actions container build and offline health smoke test provide that gate.
Check the linked PR/run result before treating it as passed.

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
