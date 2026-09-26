# Release preparation and publication

Treat prepared, tagged, published and deployed as separate states. A routine feature PR
does not authorize a release; a publication request does not authorize deployment, production
migration, Discord registration or a live game action. Preserve authorization already
given for the exact requested scope without repeating approval questions.

## Reviewable candidate

1. Establish the requested version and accepted full 40-character commit SHA. Inspect
   existing tags/releases, worktree state and current CI. Do not release a dirty worktree,
   overwrite an issued version tag, or substitute a newer main revision silently.
2. Prepare version/release notes from the actual diff, dependencies, migration ordering,
   behavior changes and limitations. Identify remaining live acceptance honestly; local
   tests do not justify describing a production-tested release.
3. Require applicable application CI for that exact revision, including real PostgreSQL
   and container checks when required by the workflow. Missing, skipped, cancelled or
   stale required checks block promotion. Repository hygiene alone is insufficient.
4. For schema changes, prove old/new runtime compatibility and a recoverable upgrade using
   [the database procedure](service-workflows.md#postgresql-and-migrations). A destructive
   contraction must wait while the deployed old runtime still requires those fields.

## Image gate

The manual `container-publish` workflow uses a full `expected_sha` that must match its
selected main revision, accepted CI and image revision. `CONTAINER_PUBLISH_ENABLED` is
initially false. The approved `container-publish` environment and configured
`DOCKERHUB_IMAGE`, `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are separate prerequisites.
Do not weaken these gates or create credentials as an incidental fix for blocked publication.

Before an authorized push:

- Verify the exact workflow implementation and its current commit checks. Read main and
  the accepted SHA again; if main moved, stop publication of the unexpected revision.
  Finish release notes/local checks while obtaining acceptance for a different revision
  or an explicitly reviewed workflow that can publish the already accepted revision.
  A missing local tag is not a reason to tag current HEAD by assumption.
- Confirm registry repository identity and private visibility before the first upload.
  The public source repository does not change the private-image deployment policy. Missing registry evidence
  or credentials means publication is blocked, not permission to guess a namespace or
  expose an image publicly. Report the concrete missing input after preparing the candidate.
- Ensure protected environment review, required exact-revision CI and the enablement
  gate are satisfied. Use immutable SHA image tags. Record the resulting digest and OCI
  source revision, then verify they match the accepted commit; do not infer success from
  workflow dispatch alone or move a released version tag to repair a failure.
- Inspect remote state after an uncertain tag/release/push result before retrying. Verify
  existing tag target, release and image digest instead of duplicating the operation.

## Handover and deployment separation

Provide the exact commit, version/tag if created, CI run, image tag/digest if published,
migration sequence, rollback compatibility and outstanding live gates. Deployment is
operator-controlled; there is no implicit auto-deploy from an image push. Keep server
secrets/configuration outside this public repository.

For a separately authorized deployment, use the current operations runbook and verify
the actual target, backup, migration, runtime lease, health and observation window.
Keep `WARDOGS_WRITES_ENABLED=false` and `roleSync.enabled=false` unless the live task
explicitly enables and accepts those capabilities. Only the literal value `true` enables
game writes. Readiness and liveness are different; an offline fixture returning readiness
503 is expected and is not production-ready. Do not resolve an incident until the
[evidence policy](evidence.md) is satisfied in the affected environment.
