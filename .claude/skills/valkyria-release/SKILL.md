---
name: valkyria-release
description: Prepare or verify a Valkyria bot release using an accepted immutable revision, application CI, migration compatibility and gated image publication.
---

# Release preparation and handover

Read [the release workflow](../../../docs/engineering/release.md), current status and
the actual publication workflow/runbook when present. This skill does not authorize
publishing, deployment, Discord registration or real game operations by itself.

1. Establish the requested version, accepted full SHA and delivery scope. Complete the
   reviewable candidate, notes, relevant checks and migration implications before asking
   for a genuinely missing final authorization/input. Preserve authorization already given.
2. Verify real required application CI for that revision and existing tag targets. If
   main moved, do not tag or publish the newer revision by assumption. Match `expected_sha`,
   workflow main revision and accepted CI; do not work around a rejected revision guard.
3. Preserve `CONTAINER_PUBLISH_ENABLED=false` until publication is explicitly enabled in
   the authorized release task. Verify protected environment approval, registry target,
   private visibility and credentials before upload. Missing evidence blocks publication, not
   local preparation, and never justifies bypassing the gate.
4. Use immutable SHA image tags and verify returned digest/source revision. Never overwrite
   an issued version tag. After an uncertain remote result, inspect tags/releases/images
   before retrying. Publication does not trigger deployment in this project.
5. With schema changes, use the database skill and prove old-runtime compatibility; do
   not remove a column still read by the deployed old image. Hand over prepared/tagged/
   published/deployed states separately with exact evidence and pending live gates.

Deployment, production migration and enabling writes or role delivery require their
own explicit live scope and current runbook. Do not label an offline health fixture
or synthetic demo as production acceptance.
