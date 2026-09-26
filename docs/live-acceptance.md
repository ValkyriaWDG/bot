# Deferred live acceptance

Status: **not performed by the bootstrap implementation**. The owner deferred application
creation, tokens, guild/game testing and server setup. Local tests and CI establish only
their named boundaries. Open a scoped live task with verified targets and supplied secrets
before executing these steps; do not request the same authorization again once provided.

Use [operations](operations.md), [commands](commands.md), [provider evidence](wardogs-api.md)
and [the website proposal](web-integration.md). Keep writes and role delivery disabled
until the relevant phase is explicitly enabled for its test target.

## Record the test context

Record full accepted SHA/image digest, test date/time with timezone, operator, selected
application/guild/server identities in the private setup record, client/platform, reply
language and role/capability setup. Public evidence uses synthetic names and sanitized
labels, not secret URLs, credentials or real player/member IDs. Record exact expected and
observed outcomes, not only checked boxes. Untested items remain not run.

## 1. Application and read-only baseline

- [ ] Verify the operator owns/administers the intended application and test guild; obtain
      actual IDs from Discord. Review installation scopes and minimal bot permissions.
- [ ] Set the exact configured guild/application and role grants, with
      `WARDOGS_WRITES_ENABLED=false` and `roleSync.enabled=false`. Review secure provider
      transport and dedicated DB settings before starting the live runtime.
- [ ] Provision the dedicated bot DB, capture private backup/restore evidence where
      upgrading, run explicit migrations and start exactly one runtime lease holder.
- [ ] Review `pnpm commands:register` offline output, then register only with the explicit
      apply/guild/application arguments authorized for this task. Inspect the saved guild
      command list after registration; prove no unrelated application's commands changed.
- [ ] Verify live liveness/readiness and graceful normal shutdown/restart. Readiness does
      not replace direct game provider or website checks.

## 2. Discord UX and role boundaries

- [ ] Verify `/help`, `/account`, `/server status` and `/server players` for permitted and
      denied synthetic roles. Confirm absence of an application grant is denied even for
      a Discord Administrator. Test foreign-guild/DM denial through the appropriate safe
      integration boundary; do not install into an unauthorized guild to test it.
- [ ] Capture default Czech replies and explicit `language:en` replies, including help,
      status/players, a safe denial and confirmation states when enabled. Command/option
      names remain English. English client description localization does not silently
      change the configured Czech-first reply default.
- [ ] From a second test member, confirm that private replies are not visible. Show player
      count truncation and absence of Steam IDs in the listing. Use synthetic hostile text
      fixtures for mention/markdown safety rather than publishing a real player's payload.
- [ ] Confirm slow external reads acknowledge privately before work and produce safe errors
      without raw tokens, URLs or upstream text. Inspect actual elapsed behavior and logs.
- [ ] Compare the live setup with role removal, actor binding, duplicate and expiry test
      results. An inaccessible ephemeral button cannot be cross-clicked through normal UI;
      the dispatcher/service regression suite supplies the explicit cross-actor proof.

## 3. Wardogs build compatibility and controlled writes

The HTTP adapter is based on the official console source, not an already verified live
Wardogs build. Use a dedicated game test server with an agreed disruption window and
synthetic players. Record the installed game build and observed wire compatibility.

- [ ] Compare authorized status/map/player observations with the actual server. Confirm
      nullable/missing fields, exact transport security and safe rejection handling.
- [ ] Before enabling writes, specify the action(s), server, impact and recovery plan.
      Enable `WARDOGS_WRITES_ENABLED=true` only for this accepted test scope; restart the
      runtime with the reviewed config and verify capability grants.
- [ ] For each authorized broadcast, kick, permanent ban, unban, map change or match restart
      scenario, inspect the exact preview and persisted intent before confirming. A match
      restart is not a host/process restart. Do not run unapproved destructive scenarios
      merely to fill a checklist.
- [ ] Remove the operator's control role after preview and before confirmation; verify
      fresh REST denial, no provider mutation and the expected safe response.
- [ ] Confirm a permitted action once; compare actual server effect and durable audit.
      Duplicate/expired confirmation must not repeat it. Combine safe live observations
      with real DB concurrency tests where deliberately duplicating a destructive live
      request would add unnecessary disruption.
- [ ] Verify successful/cancelled controls are cleared from the original ephemeral message.
      A failed cleanup cannot authorize replay; an unauthorized click must not clear the
      owner's controls. Capture the relevant states with captions.
- [ ] Exercise timeout/restart ambiguity using controlled fixtures or an explicitly accepted
      test fault. Preserve unknown outcome, reconcile actual target state and prove no
      automatic retry. Do not claim production fault injection from a local simulation.
- [ ] Return writes to the agreed post-test state and record that state explicitly.

## 4. Independent website receiver

The sender transport is proposed until the website implements and accepts it. This
checklist does not authorize edits to the sibling repository automatically.

- [ ] Agree the exact method/path, eight fields, size limits, signing bytes, headers,
      response codes, key lifecycle and producer/guild ordering scope across both repositories.
- [ ] Run identical consumer/sender fixtures for tampering, wrong guild, durable nonce/event
      replay races, old present after newer departure, duplicate/stale acknowledgements,
      observation freshness, key rotation and receiver commit-before-ack.
- [ ] In an authorized test environment, verify independent website session/OAuth behavior,
      actual role revocation, generation fencing and fresh REST positive authorization.
      A valid signature never creates a web session or grants an owner role.
- [ ] Enable required Guild Members intent only for accepted member-event observation;
      enable `roleSync.enabled` with the agreed key. Verify departure, periodic reconciliation,
      provider/receiver outage, rate limits, pending/failed outbox handling and restart.
- [ ] Show that `/account` does not falsely claim website linkage or successful delivery
      while disabled, pending or failed. Record evidence in both repositories' scoped items.

## 5. Release, deployment and recovery

- [ ] Separately authorize publication/deployment scope, verify private registry identity,
      exact accepted commit/current CI, release gates, image digest and runtime configuration.
- [ ] Prove the actual migration/rollback compatibility and backup restoration with the
      selected release. Do not run destructive integration tests against the live database.
- [ ] Deploy one runtime, verify private health access, Discord readiness and actual
      affected capabilities over a recorded observation window. Track lease loss as fatal,
      normal shutdown as draining, and interrupted actions as unknown.
- [ ] Verify alerting/escalation ownership and a rehearsed recovery path. Do not resolve an
      outage from local health alone; capture affected-environment recovery evidence.

## Acceptance record and closure

For each completed phase, attach its current-revision proof to the PR and relevant issue.
Use actual captioned screenshots for visible behavior, with command/locale/client context,
and real transport/database evidence for hidden guarantees. Inspect public-safe images
and verify links render. A local image path or synthetic transcript is not a live capture.

Document skipped or blocked scenarios and the next action. Close only the fully proven
scope; keep unsupported game-build behavior, receiver integration or unrun destructive
scenarios open. Follow [the evidence policy](engineering/evidence.md) before automatic
closing keywords or incident resolution.
