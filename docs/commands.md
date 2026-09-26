# Discord command contract

Command and option names remain English. Default descriptions and replies are Czech;
Discord command descriptions also provide `en-US` and `en-GB` localizations. Every
command and subcommand has an optional `language` choice, `cs` or `en`, to override
the configured default response language for that invocation. The Discord client's
language does not silently override the configured Czech-first response policy.
Confirmation buttons retain the language selected when preparing the operation.

All responses are ephemeral and disable allowed mentions. The dispatcher acknowledges
the interaction before membership, synchronization, database or game-server IO.
If acknowledgement fails, no operation starts. Text received from game servers is
bounded, flattened to one line and escaped for Discord markdown and mentions.

## Commands

| Command            | Required options               | Behavior                                                                             |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| `/help`            | None                           | Command overview and configured website link. No external IO.                        |
| `/account`         | None                           | Fresh membership check and effective per-server capabilities. Role IDs are omitted.  |
| `/server status`   | `server`                       | Live adapter result: name, map, player count/capacity and match time when available. |
| `/server players`  | `server`                       | First 20 player names with shown/total counts. No Steam IDs or network addresses.    |
| `/admin broadcast` | `server`, `message`            | Prepare a message to all players, maximum 200 characters.                            |
| `/admin kick`      | `server`, `steam_id`, `reason` | Prepare disconnecting one player.                                                    |
| `/admin ban`       | `server`, `steam_id`, `reason` | Prepare banning one player.                                                          |
| `/admin unban`     | `server`, `steam_id`           | Prepare removing one player's ban.                                                   |
| `/admin map`       | `server`, `map`                | Prepare changing the map and interrupting the current game.                          |
| `/admin restart`   | `server`                       | Prepare restarting the current match, not the host machine.                          |

Server choices come exclusively from validated operator configuration, with at most
25 configured choices. SteamID64 is a 17-digit string; operators obtain the identifier
through their authorized server tools, not the public player listing. Reasons have
a 200-character limit. Map names have an 80-character Discord input limit and must
also pass the service's stricter supported-name validation. Single-line action text
rejects control/format characters; descriptions do not imply arbitrary console access.

`/admin` registers with `default_member_permissions` set to `"0"`. Discord administrators
and explicit command permission overrides can make the command visible, but visibility
does not authorize execution. The operations service freshly resolves membership and
enforces configured role IDs for each capability and server. Discord Administrator,
role names and interaction payload caches are not application grants. Runtime rejects
all commands and buttons outside the configured guild, including direct messages.

`/account` is not a website login or proof of an account link. When role synchronization
is disabled, the response says so. When enabled, synchronization is reported as pending;
an optional refresh callback can enqueue delivery but cannot prove website acceptance.
A callback failure preserves the successful membership result without exposing errors
or claiming synchronization success. No raw role snapshots appear in the response.

## Confirmation behavior

Every administrative command prepares an actor/guild/server/action-bound intent. The
private preview includes the exact configured target, action and parameters, disruption
warning where relevant, and expiry. No write occurs during preparation. The operator
chooses `Potvrdit zásah` / `Confirm operation` or `Zrušit` / `Cancel`.

Button identifiers are `confirm:<opaque UUID>:<cs|en>` and
`cancel:<opaque UUID>:<cs|en>`. They contain no credentials, player data or executable
commands. The dispatcher validates their syntax and passes the clicking actor and guild
to the operations service; only the persisted intent defines what is executed. The
service verifies expiry, ownership and fresh roles, then atomically claims the intent.
The language suffix changes presentation only and cannot change the saved action.

After a consumed confirmation or successful cancellation, the runtime attempts to clear
the source buttons. Permission rejection or failed cancellation leaves the owner's
source message unchanged and sends the clicking user a private error. Clearing buttons
is best-effort presentation; durable claim/cancellation supplies replay protection.
A failed message edit cannot trigger another server action or replace its durable result.

Success, failure and unknown outcome have distinct responses. Unknown explicitly says
not to retry automatically and to verify server state first. Unexpected exceptions and
unrecognized error codes use a fixed localized fallback; raw exception text, internal
URLs and credentials never become Discord output. Delivery failures after an operation
do not authorize the runtime to replay the operation.

## Runtime adapter boundary

`src/discord/handler.ts` exports `InteractionInput`, `InteractionPort`, `OperationsPort`
and `handleInteraction`. The port is deliberately smaller than discord.js:

- Normalize slash commands into `kind: 'command'`, interaction/guild/user IDs,
  `commandName`, optional `subcommand`, and the known string `options`.
- Normalize buttons into `kind: 'button'`, interaction/guild/user IDs and `customId`.
- Forward `deferReply` and `editReply` to discord.js. Always preserve the response's
  ephemeral acknowledgement and `allowedMentions` policy.
- For `clearSourceComponents`, edit the original component message using the interaction
  webhook, not a public channel message API. The handler only calls this after the
  service consumes or cancels the intent. Do not clear unrelated messages.
- Ignore unsupported interaction kinds at the runtime boundary. Never log interaction
  tokens, raw Discord payloads, private player lists or operator input.

Command registration is a separate explicit guild-scoped operation. `buildCommands`
only produces the JSON manifest; it makes no REST requests and startup must not publish
or replace commands automatically. Bulk registration replaces the application's full
command set in that guild, so the operator must review the manifest and target IDs.

## Verification and deferred live acceptance

`tests/discord.test.ts` exercises the real manifest and dispatcher with narrow local
service/transport boundaries. It proves response ordering, guild denial, English opt-in,
safe player output, action mapping, opaque previews, consumed-outcome presentation,
non-owner rejection, cancellation and safe exception handling. Operations/store tests
must independently prove fresh authorization, atomic claims, expiry and no mutation retry.

These tests are not live Discord evidence. After bot provisioning and guild authorization,
capture captioned Czech and English command/response screenshots, verify ephemeral
visibility and command permissions, and exercise role revocation between preview and
confirmation. Confirm that original ephemeral buttons can be cleared through the
interaction webhook and that inaccessible-message cleanup still preserves one-use
execution. Use a dedicated test guild/server and report actual provider effects separately.

Official references: [application commands and permissions](https://docs.discord.com/developers/interactions/application-commands),
[interaction acknowledgement and ephemeral behavior](https://docs.discord.com/developers/interactions/receiving-and-responding),
[discord.js fresh member fetch options](https://discord.js.org/docs/packages/discord.js/14.27.0/FetchMemberOptions:Interface).
