---
name: valkyria-verification
description: Verify Valkyria bot changes or recovery with appropriate local, PostgreSQL and live evidence plus captioned screenshots before acceptance or closure.
---

# Prove the claimed result

Read [the verification matrix](../../../docs/engineering/verification.md) and
[evidence policy](../../../docs/engineering/evidence.md). Inspect actual scripts and
the changed modules before selecting checks.

1. Map each acceptance criterion to reproducible inputs, expected result and appropriate
   environment. Separate local fixture, real DB, Discord, game server and website proof.
2. Run meaningful focused checks, then the applicable full checks. Record exact revision,
   commands and outcomes; do not hide failures or count skipped checks as passed.
   `pnpm test` excludes DB integration; the offline demo and health fixture are not live readiness.
3. For visible behavior, inspect real captioned screenshots covering affected Czech/English
   states and client context. A local image path is not delivered evidence. Synthetic
   transcripts are labeled as such; missing live screenshots remain blocked, not N/A.
4. For nonvisual work, explain screenshot N/A and provide relevant alternative proof.
   Current-head CI and accessible artifacts accompany feature evidence, not replace it.
5. Put scoped acceptance proof in the PR and related issue/incident before closure.
   Production recovery requires affected-environment checks and an observation window;
   local health plus a prevention issue cannot resolve an outage.

Report passed, failed, blocked and not-run separately. Finish available independent
checks, keep incomplete acceptance open, and state the exact next input/action needed.
