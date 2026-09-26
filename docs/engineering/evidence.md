# Evidence for PRs, issues and incidents

Every feature or fix needs proof of the claimed behavior in its PR and a relevant
acceptance summary in each related issue/incident before closure or automatic closing
keywords. The owner's standing request authorizes those task-scoped evidence updates
and comments. It does not authorize unrelated communication, merging or production work.

## Required record

| Criterion               | Reproduction and expected result | Observed result                    | Revision and environment                                       | Proof and limits                            |
| ----------------------- | -------------------------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| One observable behavior | Inputs, role/fixture and steps   | Passed, failed, blocked or not run | Full SHA/build or labeled dirty worktree; local/CI/live target | Accessible artifact and what it establishes |

Use exact commands and current-head CI links. Identify both PR head and tested merge
revision when CI tests a merge result. A later code change invalidates affected old
proof. Preserve labeled historical before evidence, but refresh after evidence against
the delivered revision. Generic green badges or a test count do not explain feature proof.

## Screenshots and alternatives

- Visible command, menu, confirmation, error or localization changes need real captioned
  Discord screenshots when tested in Discord. Capture Czech and English affected states,
  desktop/mobile where layout matters, and keyboard/focus behavior when relevant.
- Record command/options, reply language, expected/observed result, client/platform,
  viewport when applicable, environment, revision and synthetic role scenario. Use clear
  alt text and nearby English captions. Shared context may cover a clearly grouped set.
- A visible fix needs comparable before/after captures when safely reproducible. If the
  old failure cannot be reproduced, explain why and provide a regression reproduction;
  never manufacture the before image.
- For multi-step confirmation or expiry, use captioned states plus a recording/trace or
  state-machine test where needed. Screenshots do not prove freshness, one-use claims,
  signatures, database durability or the real game mutation result.
- Backend, migration, CI or documentation-only changes can state screenshot **N/A with
  a specific reason** and provide relevant alternative proof. An unrun Discord check
  on visible behavior is blocked/not run, not N/A. A synthetic demo transcript or local
  test can support an implementation PR while its live visual acceptance remains open.

Capture actual implemented state, inspect every selected image and explain redaction.
No mockup, generated image, editor window or unrelated terminal is a live UI screenshot.
Prefer synthetic fixtures; remove credentials, secret URLs, real Steam/Discord IDs,
private roles, player payloads and unrelated conversations before public sharing.

## Reviewable delivery

Use supported GitHub media attachment interfaces or CI artifacts. Inspect the installed
CLI help before using attachment flags. Verify that the saved PR/issue renders images
and reviewers can open links. Local `.local/` paths, placeholder URLs and a promise to
upload are not delivered evidence. Do not send artifacts to an unapproved third-party host.

If upload is unavailable, preserve local evidence and leave that acceptance step pending.
A reviewed fallback is a small public-safe image under `docs/evidence/` with recorded
origin, capture context and redactions, embedded using a commit-pinned GitHub URL. Keep
verification images outside runtime assets. Do not commit raw private transcripts.

Record CI artifact run/name and retention when relied on. Keep the essential acceptance
summary and selected screenshot proof in the PR and issue themselves; an expiring archive
alone is insufficient durable closure evidence. Recheck accessibility before closure.

## Closure and recovery

1. Map the complete issue acceptance criteria to current proof. Distinguish implementation,
   local fixture, real PostgreSQL, test guild, live Wardogs and website receiver evidence.
2. Add each issue/incident's own acceptance/recovery summary, selected captioned images
   where applicable and links to detailed PR/test evidence. A bare PR reference is insufficient.
3. Incidents require impact, mitigation/fix, observation times with timezone, recovery
   checks in the affected environment and a justified observation window. Local healthy
   output cannot establish production recovery. Link remaining prevention work separately.
4. Re-read the saved record and links. Failed, blocked, not-run or inaccessible required
   proof keeps that item open. A draft PR or scoped implementation PR may record deferred
   live acceptance without closing the wider issue. Put evidence in place before a merge
   can trigger automatic closure.
5. Close only within authorized scope and with the actual disposition. Duplicate, cancelled
   or won't-do issues need a rationale/canonical link, not fabricated fix evidence.

Use [SECURITY.md](../../SECURITY.md) for sensitive incidents. Read saved remote state before
retrying an uncertain evidence write; completion is a proven outcome, not a posted comment.
