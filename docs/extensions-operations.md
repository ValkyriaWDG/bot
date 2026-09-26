# Website extensions operations

Issues [#11](https://github.com/ValkyriaWDG/bot/issues/11) and
[#12](https://github.com/ValkyriaWDG/bot/issues/12) add bot-side management,
publication and participation integration. They do not implement website login,
the website admin page, its event feed or its canonical roster transactions.

## Configuration and activation

No extension is active without `BOT_EXTENSIONS_FILE`. Copy
`config/extensions.example.json` to ignored `config/extensions.json`, replace all
fictional IDs with the agreed test configuration, and set the environment variable
to that file. All three `enabled` flags initially remain false.

- `management.enabled`: private HTTP listener, default `127.0.0.1:3001`.
- `publications.enabled`: durable website-event consumer, Discord publication worker
  and configured server boards. It does not enable game-server writes.
- `signup.enabled`: private button handler and public signup buttons after a verified
  website message binding. Requires the separately accepted website signup contract.

Every configured destination must belong to the single configured guild. Only guild
text and announcement channels are supported. Before dispatch, the runtime fetches
the actual channel, bot member and role definitions and checks View Channel, Send
Messages, Embed Links and Read Message History. It does not auto-crosspost messages.
Threads and forum posts require separately designed permission/lifecycle handling.

Keys are environment references, never values in JSON. Use independent random secrets
of at least 32 bytes for management read, management configure, publications, signup
and the existing role-sync transport. The resolver rejects reused values, including
the Discord and game tokens. The website client also requires distinct key IDs.
Management read and configure scopes require their own explicit Discord role grants;
Discord Administrator is not a grant. Keep the role-sync key and protocol separate.

Settings editable through the management API are limited to default command locale
and configured server display labels. These mutate the actual running configuration
and survive restart. Status-board labels, channel mappings, grant mappings, URLs,
tokens, ports and feature activation are operator configuration, not editable API
fields. Role mappings and sessions still belong to the independent web implementation.

For containers, add an operator-owned Compose override that read-only mounts the
extensions JSON at `/app/config/extensions.json`, exports `BOT_EXTENSIONS_FILE` to
that path and attaches the web backend and bot to a private integration network.
Select `management.host: "0.0.0.0"` only inside that private container network.
**Do not publish port 3001 on the host or send management credentials to browsers.**
The repository's default Compose has no management port or automatic extension mount.
Use private TLS or an authenticated encrypted network between separate hosts.

## Database and restart

Explicitly apply `pnpm db:migrate` to the authorized dedicated bot database before
starting the new revision. Migrations 002–004 add management, publication and cursor
tables; migration 001 is unchanged. Startup does not apply migrations.

The existing exclusive guild runtime lease covers these workers as well as commands.
Startup loads persisted desired settings into the effective configuration, then
recovers interrupted publication attempts. A create interrupted before the Discord
message ID was durably recorded becomes `unknown`. It is never automatically posted
again. A saved ID allows subsequent safe edits of that message.

Shutdown fences new work, closes/drains the management listener, drains periodic
work and command handlers, then releases the lease and closes PostgreSQL. Loss of
the lease remains an immediate process exit. The process has a 20-second shutdown
deadline; failure to drain is not a successful stop.

Management status reports build revision (`BUILD_REVISION`, baked into the image),
runtime observation time, database availability, Discord connectivity, lease state
and separate desired/effective revisions. Local source runs without a valid build
SHA return `unknown`. A bounded database observation runs every five seconds; status
is not evidence that the website receiver or a game provider is healthy.

## Failure and recovery

1. Disable the affected worker in operator config and restart the same accepted
   revision if uncontrolled repeated failures occur. Keep underlying rows for review.
2. For `unknown` creation, inspect the authorized test channel and audit state. Never
   blindly delete the binding/job or enqueue a second creation. The source does not
   contain a destructive automatic repair command; reconciliation is an operator task.
3. For deleted/forbidden messages, repair destination access and explicitly reconcile
   the binding. The bot does not recreate a manually deleted message automatically.
4. Website or Discord timeouts retain bounded retry state. The event cursor advances
   only after the complete page has been durably accepted. Replayed pages are deduped.
5. Signup mutation timeouts return an unknown result without retry. Check authoritative
   participation on the website before a fresh action; never infer success from the click.
6. A status board shows observation/expiry times. A previous good sample becomes stale
   when refresh fails; no previous sample means unknown. Bot downtime does not turn an
   old Discord message into live telemetry. Expired timestamps must remain visible.

Before rollback, disable extensions and stop the new runtime. These additive tables
can remain while the preceding foundation revision runs; do not delete data or rewrite
migration history. Backups and a restoration rehearsal remain deployment gates.

## Protocol and acceptance references

- [Management API](management-api.md): signed method/path/body/actor, durable replay,
  optimistic configuration update, redaction and application state.
- [Publication worker](publications.md): ordering, bindings, delivery and status semantics.
- [Website integration contract](website-publications-contract.md): exact feed,
  projection, binding and canonical participation wire formats.
- [Website implementation handoff](handoffs/website-extensions.md): remaining web work.
- [Evidence rules](engineering/evidence.md): offline screenshots are not live Discord.

The transport follows Discord's [message API](https://docs.discord.com/developers/resources/message),
[interaction acknowledgement](https://docs.discord.com/developers/interactions/receiving-and-responding)
and [rate-limit](https://docs.discord.com/developers/topics/rate-limits) contracts
(checked 2026-09-26). Nonces are bounded deduplication assistance, not indefinite
exactly-once delivery. Durable local state and explicit unknown outcomes remain necessary.
