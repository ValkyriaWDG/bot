# User guide

Valkyria's bot provides private Discord replies for account permissions, Wardogs server
information and confirmed server operations. Live application setup is a separate step;
the [testing lab](testing-lab.md) demonstrates these workflows with synthetic identities.
This guide describes implemented behavior, not a claim that a bot is already installed.

## Getting started

Use commands in the configured Discord guild. Direct messages and other guilds are denied.
Type `/help` for the command overview and configured Valkyria website link. All replies are
ephemeral: the requesting member receives the response rather than the public channel.
The bot acknowledges privately before checking external services. Actual Discord privacy
and client rendering still require the [live acceptance checks](live-acceptance.md).

Command and option names are English. Replies default to Czech in the supplied configuration.
Add `language:en` to any command or subcommand for English, or `language:cs` for Czech.
The language applies to that invocation and its confirmation buttons; it is not an account
preference. Changing the Discord client language may localize command descriptions but does
not change the configured reply default.

```text
/help
/help language:en
/account
/server status server:primary language:en
```

`primary` is the ID in the example configuration. Choose an actual configured server from
Discord's option list; do not assume the example identifies a live server. Values inside
angle brackets below are placeholders to fill through the command form.

## Check account permissions

`/account` checks current membership and lists the capabilities granted for each configured
server. It does not expose role IDs, log into the website or prove a website account link.
Capability names are technical identifiers and remain English in both response languages.

Actual response headings and notices include:

| Situation                   | Czech reply excerpt                                                            | English reply excerpt                                                     |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Account result              | `Účet a oprávnění`                                                             | `Account and permissions`                                                 |
| Membership observation      | `Členství ověřeno:`                                                            | `Membership checked:`                                                     |
| No configured grants        | `Žádná oprávnění ke správě serverů.`                                           | `No game server permissions.`                                             |
| Role delivery disabled      | `Synchronizace rolí s webem je vypnutá.`                                       | `Website role synchronization is disabled.`                               |
| Refresh queued              | `Synchronizace rolí čeká na zpracování; přihlášení na web tím není potvrzeno.` | `Role synchronization is pending; this does not confirm a website login.` |
| Enabled refresh unavailable | `Synchronizace rolí s webem je nyní nedostupná.`                               | `Website role synchronization is currently unavailable.`                  |

An observation timestamp records when membership was checked. A pending refresh means the
sender queued work; it does not mean the independent website accepted or applied it.
If membership itself cannot be verified, private operations are denied until verification
works again. An unavailable optional website refresh does not erase a successful account
membership result.

## Read server status and players

| Command                           | Required capability | Result                                                                |
| --------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `/server status server:<server>`  | `server.status`     | Server name, map, player count/capacity and match time when available |
| `/server players server:<server>` | `server.players`    | Up to the first 20 player names, with shown/total count               |

Status replies use `Stav serveru`, `Mapa`, `Hráči` and `Čas zápasu` in Czech, or
`Server status`, `Map`, `Players` and `Match time` in English. Missing match time is shown
as `není dostupný` / `unavailable`; it is not reported as a zero-length match.

The player heading follows `Hráči — zobrazeno 20 z 24` / `Players — showing 20 of 24` for
that illustrative count. There is no pagination command in the current version. Empty
results show `Na serveru nejsou žádní hráči.` / `No players are on the server.` Names are
bounded and escaped; listing results omit Steam IDs and network addresses. Moderation
targets must come from authorized operator tools, not guesses based on display names.

## Prepare an administrative operation

Every command below creates a private preview first. It cannot execute a game write until
the same member confirms a valid request in the same guild. The operator must enable
game writes and map the necessary capability for the selected server.

| Command            | Required options after `server` | Capability         | Intended effect                                  |
| ------------------ | ------------------------------- | ------------------ | ------------------------------------------------ |
| `/admin broadcast` | `message`                       | `server.broadcast` | Send a message to all players                    |
| `/admin kick`      | `steam_id`, `reason`            | `server.moderate`  | Disconnect the selected player                   |
| `/admin ban`       | `steam_id`, `reason`            | `server.moderate`  | Ban the selected player                          |
| `/admin unban`     | `steam_id`                      | `server.moderate`  | Remove the selected player's ban                 |
| `/admin map`       | `map`                           | `server.control`   | Change map and interrupt the current game        |
| `/admin restart`   | None                            | `server.control`   | Restart the current match and interrupt the game |

```text
/admin broadcast server:<server> message:<announcement>
/admin kick server:<server> steam_id:<SteamID64> reason:<reason>
/admin ban server:<server> steam_id:<SteamID64> reason:<reason>
/admin unban server:<server> steam_id:<SteamID64>
/admin map server:<server> map:<map-name>
/admin restart server:<server> language:en
```

Messages and reasons are single-line text, maximum 200 characters. SteamID64 must be a
17-digit string verified through authorized server tools. Map input is 1–80 letters,
digits, underscores or hyphens; passing input validation does not prove that the installed
game build supports that map. Select the exact supported map from operator knowledge.
`restart` restarts a match, not the host machine or game-server process. The bot has no
arbitrary console command, host restart or mass moderation endpoint.

### Review, confirm or cancel

1. Read `Potvrzení zásahu` / `Confirm operation`. Check the exact server, action, target,
   supplied text and `Platnost do` / `Expires` timestamp. New requests expire after 60 seconds.
2. Choose `Potvrdit zásah` / `Confirm operation` to proceed, or `Zrušit` / `Cancel` to
   cancel. A preview alone sends no game mutation. Closing Discord does not confirm it.
3. Confirmation checks current membership and capability again. A removed role, expired
   request, wrong actor or already consumed intent cannot authorize execution.
4. Read the resulting private response. The bot attempts to remove the old buttons after
   a consumed confirmation or successful cancellation. An old visible button can remain
   after a message-edit failure; the durable one-use record still prevents another effect.

Cancellation replies `Žádost byla zrušena.` / `The request was cancelled.` It does not
undo an action already dispatched. If confirmation and cancellation race, only the saved
state determines what happened; inspect the result rather than assuming cancellation won.
An unauthorized click does not remove the owner's controls.

### Understand the result

| Outcome           | Actual Czech reply                                                                     | Next action                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Provider accepted | `Server přijal požadavek. Ověřte jeho výsledek na herním serveru.`                     | Check the actual game effect; acceptance is not independent proof of its final state |
| Failed            | `Zásah se nezdařil. Před další žádostí ověřte stav serveru.`                           | Check target state and operator diagnostics before another request                   |
| Unknown           | `Výsledek zásahu není známý. Neopakujte jej automaticky; nejdřív ověřte stav serveru.` | Stop automatic retries; ask the operator to reconcile the target and saved action    |

The English unknown response is `The operation outcome is unknown. Do not retry automatically;
first verify the server state.` A timeout or delivery failure can occur after the server
received a request. A missing success message therefore does not mean nothing happened.

## How roles and configuration affect access

The operator maps Discord role **IDs** to capabilities independently for each game server.
A role name, guild ownership or Discord Administrator permission is not an application
grant. Capabilities do not imply one another: `server.control` alone does not grant player
listing or broadcasting. Several roles can grant the same capability.

| Configuration                  | User-visible consequence                                                        |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `guildId`                      | Commands and buttons work only in this guild                                    |
| `defaultLocale`                | Default reply language, `cs` in the supplied example                            |
| `servers[].id` / `label`       | Allowed server choices and preview target labels                                |
| `servers[].grants`             | Required role IDs for each capability on that server                            |
| `WARDOGS_WRITES_ENABLED=false` | Administrative preparation/confirmation is disabled even for an authorized role |
| `roleSync.enabled=false`       | Account response reports website role synchronization disabled                  |

`/admin` starts with Discord default permissions `0`. Discord command visibility may need
an operator to configure the guild integration, but making the command visible is not an
application capability grant. If access fails, use `/account` and the
[troubleshooting guide](troubleshooting.md); do not share tokens or private role/player data
in public reports. Operators should use [operations and setup](operations.md) for configuration.

## Documentation and proof

See the [command contract](commands.md) for implementation boundaries, the
[testing lab](testing-lab.md) for reproducible synthetic workflows, and the
[documentation index](index.md) for setup, architecture and delivery references.
Lab screenshots show the local viewer and actual recorded synthetic responses; they are
not screenshots of Discord or evidence that a live game server changed.
