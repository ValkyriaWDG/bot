# Troubleshooting

Start with the exact command, selected server, response language, time/timezone and observed
result. Public reports must omit bot tokens, database URLs, private player/member identifiers
and raw operator configuration. Use the [issue evidence policy](engineering/evidence.md)
or [security procedure](../SECURITY.md) for sensitive failures.

## Discord commands and permissions

| Symptom or exact response                                        | Meaning                                                                     | Next action                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Slash commands are absent                                        | Application installation or explicit command registration may be incomplete | Ask the operator to verify the application/guild and reviewed manifest; startup does not register commands       |
| `/admin` is not visible                                          | Discord command visibility is restricted by default                         | Operator checks the guild integration permissions, then independently checks application capability grants       |
| `Pro tuto akci nemáte oprávnění.`                                | Fresh membership does not grant the required capability                     | Use `/account`; operator checks the selected server's role-ID mapping. Discord Administrator is not a substitute |
| `Příkaz lze použít pouze na určeném serveru Discord.`            | Wrong guild or a direct message                                             | Run in the configured guild; do not install elsewhere merely to bypass the restriction                           |
| `Členství a oprávnění nyní nelze ověřit. Zásah nebude proveden.` | Membership verification is unavailable, stale or inconsistent               | Wait for operator diagnosis of Discord REST/guild configuration; no cached-role override                         |
| Replies remain Czech in an English client                        | Reply language follows configuration                                        | Add `language:en`; the client only localizes command descriptions                                                |
| No game server permissions in `/account`                         | Membership can be valid without any mapped capabilities                     | Request the needed per-server capability from the operator; do not share a private role snapshot publicly        |

The player list intentionally shows at most 20 names and omits Steam IDs. Missing match
time means the upstream value is unavailable, not that the match just started. Escaped or
shortened player text is expected safe output, not permission to copy raw names into reports.

## Administrative requests

| Symptom or exact response                                                              | Meaning                                                                            | Next action                                                                                    |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Změny herního serveru jsou vypnuté.`                                                  | Runtime game-write gate is disabled                                                | Leave it disabled until the operator has authorized and prepared the intended test/live action |
| Invalid command/input notice                                                           | Missing/invalid options or unknown configured server                               | Use the server choices; check text limits, 17-digit SteamID64 and supported map spelling       |
| `Potvrzení již není platné. Stav akce ověřte před vytvořením nové žádosti.`            | Intent expired, was consumed, belongs elsewhere or is unavailable                  | Inspect the previous outcome before preparing another request                                  |
| `Tento požadavek už byl přijat. Před další žádostí ověřte jeho stav.`                  | Duplicate interaction identifier                                                   | Check the existing request; do not work around one-use protection                              |
| Buttons remain after an outcome                                                        | Source message edit may have failed                                                | Trust the saved result and investigate; a displayed button does not make the intent reusable   |
| Permission changed after preview                                                       | Confirmation rechecks authorization                                                | Restore access only through the legitimate role process; an old preview cannot grant access    |
| `Výsledek zásahu není známý. Neopakujte jej automaticky; nejdřív ověřte stav serveru.` | Request may have reached the provider, or durable completion could not be recorded | Reconcile the game state and saved intent/audit before any new write                           |

`Server přijal požadavek. Ověřte jeho výsledek na herním serveru.` means the adapter received
an accepted response. Verify the actual game effect independently. A failed or missing
Discord message after execution does not undo the server operation. Cancellation cannot
undo a dispatched action, and `restart` does not restart the host machine.

## Website role synchronization

`/account` distinguishes disabled, pending and unavailable delivery. None of these notices
creates a website session or proves account linkage. Sign into the website through its
own authentication flow when that independent service is available.

Operators should compare the agreed [role-sync contract](web-integration.md), configured
receiver path/key, sender outbox and receiver acknowledgement. Do not print signatures,
raw membership events or secrets. A transport timeout can follow a committed receiver
event; retry must preserve the event's identity and ordering. Failed/quarantined delivery
requires the documented operator recovery process, not an arbitrary public repair command.

## Local lab

| Symptom                                       | Check                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab:run` or a test script is missing         | Read current `package.json`, checkout and installed dependencies; verify the intended revision                                                                       |
| Lab rejects the database URL                  | Check the [exact scheme/database/host guard](testing-lab.md); use the [dedicated lab fixture](lab-database.md), never an existing application database               |
| PostgreSQL is unreachable                     | Check that local disposable service/port and credentials privately; absence of DB access is blocked evidence, not a pass                                             |
| Viewer has no report                          | Run the lab successfully and check `.local/lab/report.json`; do not handwrite a passing report                                                                       |
| Viewer shows an older run                     | Check `LAB_REPORT_FILE`, compare revision/time, run `lab:run` and reload. The CLI replaces old output with running/failed state; E2E alone does not publish a report |
| Viewer reports unavailable after a failed run | Inspect the CLI exit and current report execution state. Do not restore an old green report and present it as the failed attempt's result                            |
| `lab:curate` refuses captures                 | Generate report and browser captures from the same clean source commit; inspect their hashes/dirty flags rather than editing provenance                              |
| `check:evidence` fails                        | Compare actual report/image hashes, PNG dimensions, captions, scenario checks and source/viewer identity; regenerate inconsistent evidence                           |
| Playwright browser cannot launch              | Follow the committed browser installation/configuration; distinguish a browser prerequisite failure from a product assertion                                         |
| Screenshot text looks wrong                   | Compare raw report and handler output, locale, CSS/font rendering and viewport; retain actual failure capture                                                        |

The local viewer is a simulation, not Discord. A private-acknowledgement flag in a report
does not prove live ephemeral visibility. An HTTP fixture's accepted write is not a live
Wardogs effect. See [testing lab](testing-lab.md) for the exact proof boundary and commands.

## Runtime, database and deployment

Use [operations and setup](operations.md) for actual commands. The runtime does not load
`.env` implicitly; use exported environment or explicit Node `--env-file`. Startup does
not apply migrations. A production image contains compiled code; use its explicit Node
migration entry point or the reviewed Compose maintenance service, not development scripts.

| Observation                                 | Operator response                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/health/live` is unavailable               | Inspect process/container and private network path; avoid drawing conclusions from a failed monitoring connection alone                                |
| `/health/ready` returns 503 in offline mode | Expected fixture behavior; offline mode has no Discord/database readiness                                                                              |
| Live readiness returns 503                  | Check Discord readiness, DB connection and shutdown state; it does not diagnose the Wardogs provider                                                   |
| Second runtime fails or lease is lost       | Establish the legitimate single instance; never bypass the lease or recover another active process's actions                                           |
| Runtime loses its lease                     | Fatal exit stops work immediately; a possibly dispatched action needs unknown-outcome reconciliation                                                   |
| Migration checksum/schema fails             | Stop rollout and inspect preserved migration history/restore evidence; do not edit applied migrations to force success                                 |
| Image publication is blocked                | Check accepted full revision, current main/CI, explicit gate, protected environment and private registry evidence; do not silently choose a new commit |

Keep incident resolution tied to recovery in the affected environment with an observation
window. A healthy local lab, synthetic screenshot or prevention issue cannot establish
production recovery. Record blocked checks and next steps without repeating a potentially
destructive action for a cleaner screenshot.
