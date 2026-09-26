---
name: valkyria-delivery
description: Start or resume a Valkyria bot implementation task and carry a bounded change through integration, verification and an honest handover.
---

# Deliver a bot change

Read [AGENTS.md](../../../AGENTS.md), the issue, current status and
[workflow](../../../docs/engineering/workflow.md). Route domain work through the
[skill catalog](../../../docs/engineering/skills.md); do not load every guide by default.

1. Inspect the actual checkout, branch, dirty files and requested outcome. Identify
   current authorization and deferred live dependencies. Continue already-authorized
   work; skill use does not grant a new external scope.
2. Define observable acceptance and the smallest coherent slice. Check
   [contracts](../../../src/contracts.ts) against callers before dividing work. Give
   parallel workers explicit paths, contract signatures and a verification checkpoint;
   one coordinator owns staging and remote delivery.
3. Add a failing behavioral test before implementation. Keep policy, serialization and
   transaction behavior real in tests; substitute only external boundaries. Implement
   the slice and update its canonical contract when behavior changes.
4. Reconcile worker changes, review the diff and run the applicable
   [verification matrix](../../../docs/engineering/verification.md). Distinguish local,
   PostgreSQL, Discord, Wardogs and website-consumer evidence.
5. Deliver the authorized PR/local result with [proof](../../../docs/engineering/evidence.md).
   Record exact revision, commands, observed results, open live gates and next action.
   Keep incomplete acceptance open; do not merge, register commands or publish as a side effect.

Missing credentials block dependent live work only. Finish code, offline fixtures,
documentation and reviewable delivery while preserving that limitation explicitly.
