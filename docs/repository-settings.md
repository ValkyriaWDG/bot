# Repository configuration

The public `ValkyriaWDG/bot` repository follows the website's delivery configuration.
This document records the bootstrap settings, not an assertion that they cannot change.
Read the current GitHub API state before relying on them for a release.

- Default branch `main`, pull requests, strict required `Quality gate` from GitHub Actions,
  administrator enforcement, resolved review conversations and linear history.
- Squash merge only, automatic branch deletion, no force-pushes or branch deletion.
  Stale reviews are dismissed; the required approval count is zero, matching the website.
  This is not a mandatory independent human approval gate.
- Issues/projects enabled; wiki, discussions and downloads disabled. Labels separate
  Discord, Wardogs, auth, database, delivery, incidents and live acceptance.
- Actions token defaults to read-only and cannot approve pull requests. Workflow actions
  are pinned in source. Vulnerability alerts, secret scanning and push protection are enabled.
- `container-publish` environment has maintainer review and protected-branch restrictions.
  Self-review and administrator bypass remain allowed as in the website configuration;
  do not describe this as an unbypassable multi-person approval control.
- Repository variable `CONTAINER_PUBLISH_ENABLED=false`. Registry image name and secrets
  are deferred. No image was published and no automatic deployment is configured.

Milestones separate reviewed source, live integration acceptance and controlled production
release. See [the roadmap](roadmap.md) and its linked issues for acceptance evidence.

AI attribution suppression is in `.claude/settings.json`; commit checks reject recognized
AI co-author/generated footers and agent session links. Preserve the configured human Git
identity. Public hygiene checks are deliberately not described as comprehensive secret scans.
