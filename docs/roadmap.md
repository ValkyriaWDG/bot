# Delivery roadmap

The issue scopes below are tracked in GitHub; their existence is not a claim of completion.
Code/tests are implemented locally; current acceptance evidence belongs in the maintained
status and exact CI/PR records. Wider live acceptance remains deferred.

| Scope                        | Issue                                             |
| ---------------------------- | ------------------------------------------------- |
| Reviewed implementation      | [#1](https://github.com/ValkyriaWDG/bot/issues/1) |
| Application and test guild   | [#2](https://github.com/ValkyriaWDG/bot/issues/2) |
| Discord UX and authorization | [#3](https://github.com/ValkyriaWDG/bot/issues/3) |
| Wardogs live contract        | [#4](https://github.com/ValkyriaWDG/bot/issues/4) |
| Website receiver             | [#5](https://github.com/ValkyriaWDG/bot/issues/5) |
| Private image publication    | [#6](https://github.com/ValkyriaWDG/bot/issues/6) |
| Deployment and recovery      | [#7](https://github.com/ValkyriaWDG/bot/issues/7) |

Every issue below requires [acceptance proof](engineering/evidence.md) in the issue and
PR before closure. Use `Refs` where a PR delivers only part of a wider live scope.

## 1. Accept the independent bot implementation

**Stage:** source implementation present; final repository/CI acceptance follows actual evidence.

**Scope:** configured guild/server capabilities, Czech-first commands, actor-bound action
confirmation, Wardogs adapter, durable PostgreSQL action/audit/outbox, signed role sender,
runtime/health, explicit CLIs, synthetic demo and delivery scaffolding.

**Acceptance:**

- Current-head typecheck, lint, unit/transport tests, build and repository checks pass.
- Real disposable PostgreSQL tests prove concurrent claim/audit and outbox lease behavior;
  absent DB access is disclosed rather than silently skipped.
- Container offline smoke and synthetic demo are labeled with their actual boundaries.
- PR evidence documents implemented behavior and leaves guild/provider/receiver/deployment
  acceptance open. No bot token, registration or production action is implied.

## 2. Provision the application and dedicated test guild

**Stage:** deferred to owner-provided setup task. **Depends on:** accepted implementation.

**Scope:** application ownership, bot token secret storage, actual target IDs, minimal guild
installation, role capability mapping, dedicated DB and secure provider configuration.

**Acceptance:**

- Verified application/guild/server/role identities are supplied privately, never invented.
- Writes and role delivery remain disabled. Minimal permissions/intents are documented.
- Offline manifest reviewed, explicitly authorized guild registration verified after apply.
- Dedicated runtime starts with one lease and private liveness/readiness; setup evidence
  contains no token, raw config or private identifiers.

## 3. Accept Czech and English Discord UX and authorization

**Stage:** deferred live test. **Depends on:** provisioned test guild.

**Scope:** command visibility, reply language, private responses, safe output, role capability
denials, confirmations and source-button lifecycle in the actual client.

**Acceptance:**

- Captioned Czech/English captures show affected command/success/error states and client context.
- A second member cannot view ephemeral output; player lists omit platform IDs.
- Discord Administrator without a configured capability is denied. Changed roles between
  preview and confirm are rechecked; fixture/DB evidence covers cross-actor and duplicate races.
- Slow/failed dependencies return safe responses. Inaccessible-message cleanup never
  replays an operation. Required live evidence is attached before closing this scope.

## 4. Verify the installed Wardogs build and controlled actions

**Stage:** deferred dedicated game-server test. **Depends on:** setup and agreed test actions.

**Scope:** actual installed build versus official-console-derived adapter, HTTPS transport,
read results, and individually authorized broadcast/moderation/map/match-restart scenarios.

**Acceptance:**

- Document actual game build, endpoint/response compatibility and nullable-field behavior.
- Each accepted mutation has a reviewed preview, one durable claim/audit and verified effect.
- Role revocation, expiry and duplicate confirmation cause no additional provider action.
- Unknown result is reconciled without automatic retry. Unrun disruptive cases remain open;
  match restart is never presented as machine restart.

## 5. Agree and accept the website role-sync consumer

**Stage:** proposed cross-repository integration, disabled. **Depends on:** a separately scoped
website receiver implementation and test environment.

**Scope:** agree the proposed transport in [web integration](web-integration.md); independently
implement receiver validation, replay/order storage and website policy invalidation.

**Acceptance:**

- Both repositories pass shared signing/acknowledgement fixtures and durable replay races.
- Newer departure cannot be overwritten by an older present event; retries do not refresh
  observation time or create a second logical event.
- Live test proves revocation, fresh REST grants, key rotation, receiver commit-before-ack,
  outage/recovery and outbox quarantine handling. Bot events do not create web sessions.
- Enable role delivery only after accepted configuration; record evidence in both scoped items.

## 6. Publish the first accepted private image

**Stage:** disabled publication gate. **Depends on:** accepted release revision and explicitly
authorized image publication with registry/environment setup.

**Scope:** select a version, prepare release notes/migration compatibility and publish an
immutable image from the exact accepted commit through the guarded workflow.

**Acceptance:**

- Full `expected_sha`, main revision and required application CI agree; moved main cannot
  silently substitute a different candidate. Existing tags are not overwritten.
- Private registry identity/visibility, secrets and protected environment approval verified.
- Returned immutable image digest and OCI revision identify the accepted source commit.
- Report publication separately from deployment and disclose any remaining live gates.

## 7. Deploy and rehearse recovery on the authorized target

**Stage:** deferred operator deployment task. **Depends on:** reviewed image and relevant
accepted live capabilities; production scope and target must be supplied explicitly.

**Scope:** private configuration/networking, explicit migrations, single runtime lease,
health observations, backup restoration, rollback compatibility and incident procedure.

**Acceptance:**

- Restore a private backup into a separate disposable database; prove the actual upgrade
  and old-runtime compatibility before destructive contraction.
- Deploy the reviewed digest with no public health/RCON exposure and no automatic command
  registration. Writes and role delivery have explicit accepted states.
- Verify graceful normal shutdown, fatal lease loss and unknown-action reconciliation.
- Record affected-environment capability checks and observation window; link remaining
  prevention work. Resolve only after actual recovery evidence is present.

## 11. Private website bot management

Tracked in [#11](https://github.com/ValkyriaWDG/bot/issues/11), with the web admin UI in
[www #22](https://github.com/ValkyriaWDG/www/issues/22). Bot implementation now includes
the private signed API, independent fresh-role grants, durable replay/config/audit,
optimistic updates and separate desired/effective state. See [the contract](management-api.md).
Independent web UI/client implementation and live acceptance remain open.

## 12. Match publications, canonical signup and status boards

Tracked in [#12](https://github.com/ValkyriaWDG/bot/issues/12), coordinated with canonical
rosters in [www #7](https://github.com/ValkyriaWDG/www/issues/7). Bot implementation includes
durable event ingestion, bounded Discord workers, CS/EN match/result embeds and private
signup buttons backed by the website contract. Configured status boards expose current,
stale and unknown observations with expiry. See [publications](publications.md) and the
[website handoff](handoffs/website-extensions.md). Actual receiver/roster transactions,
test-guild screenshots and deployed interoperability are separate acceptance gates.

Scheduled reminders and broader statistics remain future product scopes. No feature
is enabled by the existence of its implementation, migration or issue.
