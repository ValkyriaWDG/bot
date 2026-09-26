# Engineering and GitHub workflow

## Intake and implementation

1. Read the root working agreement, current status, design and issue. Inspect Git branch,
   status, remote and configured author. Establish the observable outcome and current
   authorization, including any owner-deferred live work. Do not repeat an approval
   request for an action already authorized in the active task.
2. Select the smallest coherent slice and relevant skills. Identify shared contracts,
   migrations, command UX and external dependencies. Treat live source and current tests
   as authoritative when older status snapshots differ; resolve the contradiction explicitly.
3. For independent parallel work, assign nonoverlapping paths, contract signatures, test
   responsibilities and a return checkpoint. Workers do not commit, push or open competing
   PRs. The coordinator reconciles boundary changes before overall verification.
4. Write a behavioral regression first, observe its expected failure, then implement.
   Keep real policy/serialization code under test and substitute only external boundaries.
   Do not add tests that merely grep prose or mirror an implementation constant.
5. Run focused checks, then the [verification matrix](verification.md) appropriate to the
   completed diff. Review source, tests and documentation together. Fix integration failures;
   do not omit an unrelated failing check from the report.
6. Complete independent work when a credential or environment is unavailable. Record the
   precise blocked acceptance item, owner/input needed and next action. Do not substitute
   a synthetic result for a real guild, provider, website or PostgreSQL acceptance claim.

## Repository delivery

The initial owner task authorizes scoped repository/PR/metadata work. Preserve narrower
subtask assignments such as read-only or no-remote work. Ordinary implementation does
not authorize merging, releases, command registration or production changes.

- Use a task branch and one coherent PR. Review the staged diff and secret/attribution
  checks before committing with the configured identity. Never import parent-workspace
  files, force-push shared history, or bypass branch protection to make delivery pass.
- PR descriptions explain the problem, resulting behavior, tests and practical limits.
  Use the repository template when present. Write exact multiline bodies to a file for
  CLI submission; avoid shell-built descriptions that can execute embedded content.
- Attach [evidence](evidence.md) for every acceptance criterion. Read the PR's current
  full head SHA and the corresponding CI runs. An old green run, a skipped required job,
  or passing local checks alone is not current required CI acceptance.
- Before `Closes #N`, issue completion or incident resolution, place the relevant
  acceptance/recovery summary and applicable captioned screenshots in that item too.
  Keep incomplete live scope open and use `Refs #N` where closing would be premature.
- The owner's standing evidence request permits task-scoped PR/issue/incident evidence
  updates and comments. It does not permit unrelated messages, review requests, mass
  notifications or expanding the task. Check saved state after a timeout before retrying
  an issue edit, comment, push or PR creation; never duplicate an uncertain write blindly.
- Stop at a reviewable PR unless merge is explicitly requested. For an authorized merge,
  recheck exact head, required CI, unresolved review findings and applicable evidence;
  use the supported merge path without policy bypasses. Any later push requires reevaluation.

## Handover

Record the changed behavior, tested full SHA or clearly labeled dirty worktree, exact
commands/results, accessible PR/run/artifact links, open acceptance items and next action.
Keep maintained status current. Do not treat a merged PR or posted comment as proof of
live readiness. No AI co-author, generated-by footer or session URL belongs in the commit/PR.
