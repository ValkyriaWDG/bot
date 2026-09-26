---
name: valkyria-auth
description: Implement or review Valkyria fresh guild-role authorization, actor-bound operations and authenticated website membership synchronization.
---

# Authorization and signed membership

Read [the security boundaries](../../../docs/engineering/service-workflows.md#membership-capabilities-and-website-events),
[operations](../../../src/operations.ts) and [role-sync proposal](../../../docs/web-integration.md).
Select the affected tests in [operations](../../../tests/operations.test.ts) or
[role synchronization](../../../tests/rolesync.test.ts).

1. Name the actor, configured guild/server and required capability. Use fresh server-side
   REST membership and configured role IDs; cache, role names and Discord Administrator
   do not grant application capabilities. Unknown lookup fails closed without inventing departure.
2. For mutations, prove disabled writes, role removal between preview and confirmation,
   wrong actor/guild, expiry and duplicate claims. Audit/durable claim failure must prevent
   provider dispatch. The persisted intent defines the action being confirmed.
3. For synchronization, work in [service](../../../src/rolesync/service.ts) and
   [signing](../../../src/rolesync/signing.ts). Preserve immutable event identity, sequence
   and observation time; retry the same event with a fresh signed envelope.
4. Prove tampering, wrong guild, stale observation, departure/refresh races, replay/order
   assumptions and bounded failure handling. Stateless HMAC verification is not a complete
   receiver or proof of current permission; the consumer must enforce durable replay and freshness.
5. Keep the website's OAuth, sessions and grants independent. Do not edit its repository
   or database implicitly. Leave role delivery disabled until both implementations pass
   agreed fixtures and authorized live acceptance; report this boundary in PR evidence.

Return the permission/contract change and tests that deny incorrect grants. Never expose
tokens, full membership snapshots or raw provider errors in public artifacts.
