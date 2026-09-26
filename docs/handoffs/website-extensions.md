# Website implementation handoff: bot control and match publications

Bot scope: [#11](https://github.com/ValkyriaWDG/bot/issues/11),
[#12](https://github.com/ValkyriaWDG/bot/issues/12).
Web scope: [#22](https://github.com/ValkyriaWDG/www/issues/22),
[#7](https://github.com/ValkyriaWDG/www/issues/7), and existing auth/role-sync work.

## Ownership

The website owns Discord OAuth, sessions, legacy administrator login, web RBAC,
canonical matches/results/publication decisions and participation transactions.
The bot owns Discord delivery, fresh membership observation, private ephemeral
button responses, independent audit and operational configuration. No shared database.
English code/docs; Czech default website/Discord copy with explicit English.

The bot implementation is not an SSO issuer. Keep Discord OAuth in the website's
server-side authentication flow, use stable Discord user IDs, and consume the existing
[role-sync protocol](../web-integration.md) independently of these new endpoints.

## Implement in the web repository

1. Read [management-api.md](../management-api.md),
   [website-publications-contract.md](../website-publications-contract.md),
   [publications.md](../publications.md) and their named executable tests. Use the exact
   schemas and signing vectors, including raw body and exact query string. Do not
   silently substitute the role-sync signature or key.
2. Add backend-only management client to the private bot listener. The browser calls
   authenticated/CSRF-protected web routes. Resolve actor from the trusted web session,
   enforce web permissions and let the bot independently enforce fresh guild roles.
3. Implement `/admin/bot`: status with observation age and disconnected/unknown states;
   desired/effective revisions; validated default-locale/server-label form; optimistic
   save with reason/correlation ID; show conflict/apply-pending/error distinctly.
   Never expose tokens, arbitrary endpoints, grant editing or remote shell controls.
4. Persist publication events in the same transaction that changes canonical public
   match content. Supply a bounded monotonically ordered per-guild event feed and
   per-locale publication projection. Produce tombstones on withdrawal. Use decimal
   strings for cursors/revisions; never convert them through JavaScript Number.
5. Persist and validate bot message bindings. Acknowledge only after commit. Binding
   identity includes publication, revision, guild/channel/message and locale. Reject
   obsolete/foreign bindings; returning a newer match alone is not an acknowledgement.
6. Resolve signup actors by authenticated bot request + stable Discord ID linked to a
   web account. Bind every interaction to its original guild/channel/message. In one
   transaction enforce publication, eligible member, registration window, locks,
   roster capacity/reserves, optimistic revision and durable idempotency receipt.
   Recheck at mutation time; context/preflight is not permission to write later.
7. Return authoritative participation after commit, including reserved/declined states.
   Unknown outcomes require read/reconciliation, not blind replay with a new key.
   Keep one canonical roster used by both web forms and Discord buttons.
8. Implement CS/EN copy and privacy-safe audit. Use separate narrowly scoped service
   keys, bounded bodies, constant-time HMAC verification, freshness windows, durable
   nonce uniqueness, content-type checks and no redirect-based credential forwarding.

## Shared acceptance before activation

- Independent signer/verifier agreement, stale signature rejection, wrong purpose,
  raw-body tampering, wrong guild/actor, key rotation and replay races.
- Web role revocation and fresh bot-side role denial; website session issuance verified
  through the real OAuth flow, separately from role synchronization.
- Published/corrected/cancelled/withdrawn match transitions, crash after Discord create,
  replayed event pages and persisted cursor recovery; drafts never become public embeds.
- Two users contending for the last roster slot, duplicate interaction after commit,
  changed lock between context and mutation, missing link, membership loss and outage.
- Real test-guild CS/EN screenshots, button privacy and same-message result/status edits.
- Web admin screenshot proof for desktop/mobile, conflict/error and desired/effective state.

Bot unit, local HTTP and real PostgreSQL fixtures establish the bot behavior and the
proposed protocol. They do not establish interoperability with the separately developed
web receiver. Keep both issues open until their complete acceptance evidence is present.
