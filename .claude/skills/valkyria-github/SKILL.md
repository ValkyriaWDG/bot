---
name: valkyria-github
description: Deliver Valkyria bot branches, issues and pull requests with exact-head CI and reviewable acceptance evidence within the authorized task scope.
---

# GitHub delivery

Read [the GitHub workflow](../../../docs/engineering/workflow.md#repository-delivery),
[AGENTS.md](../../../AGENTS.md) and [evidence policy](../../../docs/engineering/evidence.md).

1. Establish the requested delivery and existing authorization. The bootstrap includes
   scoped PR/repository metadata work and related evidence updates; a narrower read-only
   subtask still forbids remote mutation. Do not request permission again for an already
   authorized action or infer unrelated authority from a working credential.
2. Inspect dirty files, branch/base/remotes and configured author. Coordinate one staging
   owner, review the exact diff and attribution, and use a scoped branch/PR. No shared
   force-push, invented identity, AI co-author or session/generated-by footer.
3. Complete relevant checks and write the concrete behavior, issue links, current revision,
   proof and limitations into the PR. Use a body file for multiline CLI content. Verify
   the saved result and artifact accessibility.
4. Read required CI at the current full PR head; stale, missing or skipped checks are not
   acceptance. Add related issue/incident proof with applicable captioned screenshots
   before closure keywords. Use `Refs` and leave incomplete live acceptance open.
5. Stop at the PR unless merge is explicitly requested. An authorized merge still requires
   fresh head/CI/evidence and normal policy checks; it does not authorize release or deploy.

The owner's standing evidence request permits task-scoped acceptance comments, not
unrelated messaging or review requests. After an uncertain remote write, read saved
state before retrying. Return exact PR/head/run links and the remaining acceptance items.
