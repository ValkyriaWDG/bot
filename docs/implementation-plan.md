# Implementation plan

Design: [service boundaries and acceptance](design.md). Execute under the owner's
delegated design/implementation authority, with disjoint module ownership.

1. Bootstrap pinned Node/TypeScript tooling and configuration validation. Test missing
   secrets, wrong guild/server inputs, insecure URLs and unsafe role grants before
   implementing the parsers. Supply only sanitized configuration examples.
2. Implement PostgreSQL migrations/store and confirmation authorization service.
   Prove actor/guild binding, expiry, fresh role revocation, duplicate interaction and
   atomic one-use claim; include real PostgreSQL integration tests in CI.
3. Verify official Wardogs console wire calls and implement the bounded HTTP adapter.
   Test actual requests against local fixtures: methods/bodies, bearer auth, malformed
   responses, timeout, 429, credential redaction and no mutation retry/redirect.
4. Implement role-sync signing, durable outbox, gateway observations and REST
   reconciliation. Prove ordering/replay metadata, departure, retry and unknown
   membership behavior. Document the exact proposed web consumer contract separately.
5. Implement localized slash command definitions and interaction handling. Prove
   denied access sends no control request; preview/confirmation executes only the
   saved operation after fresh authorization. Expose status/account/help safely.
6. Compose runtime, health/shutdown, migrations/registration CLI and offline demo.
   Registration must be explicit, guild-scoped and dry-run by default. Offline demo
   must never connect to Discord, the real website or a game server.
7. Add agent skills/guides, public repository hygiene, CI, container/runtime examples,
   disabled image publication and staged live setup/acceptance runbooks. Mirror the
   website repository settings and evidence requirements. Keep live issues open.
8. Review integrated security/reliability boundaries, run all meaningful checks,
   publish scoped PR with actual evidence and record outstanding live verification.

## Review focus

- Role removal between preview and confirm: test fresh REST denial, no RCON call.
- Duplicate/late confirmation or restart during dispatch: atomic claim; unknown
  outcome never silently retried, operator follow-up documented.
- Departure followed by old outbox delivery: monotonically ordered snapshots and
  consumer replay/sequence rules; retries cannot resurrect old roles.
- HTTP redirect/timeout/429: no credential forwarding or unsafe action retry.
- Public artifacts: synthetic IDs and redacted responses; no credential or raw
  player/private-role spill into logs, PRs, screenshots or audit metadata.
