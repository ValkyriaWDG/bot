# Wardogs press kit: bot presentation references

This is a curated asset catalog and an **offline presentation proposal**. It does
not change command responses, send messages, configure Discord branding or implement
a public status board. Open the [local catalog preview](presskit-preview.html) to
inspect artwork and the illustrative payloads. It is not a Discord screenshot.

## Included material

The owner supplied the January 2026 Wardogs press kit. Four unmodified raster files
are retained under [the asset catalog](../../assets/presskit/wardogs-january-2026/catalog.json).
That catalog records original names, measured dimensions, sizes, SHA-256 and provenance.
Its checked allowlist is the authority for repository inclusion; other press-kit
files, the trailer, PDFs and SVGs are not runtime inputs.

| Repository filename  | Source dimensions | Useful presentation                                                                             |
| -------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `key-art-1080p.png`  | 1920 × 1080       | Optional wide image below `/help` or a separately approved introduction                         |
| `flying.jpg`         | 3840 × 2160       | Generic game illustration below status text; not proof of the selected map or live server state |
| `fullmark-white.png` | 2468 × 490        | Wide wordmark on a dark presentation background                                                 |
| `fullmark-full.png`  | 2468 × 490        | Wide wordmark and supplied tagline on a dark presentation background                            |

Keep the 16:9 compositions and wide logo aspect ratios. Do not stretch the wordmarks
into square avatars, replace Valkyria's identity with the game publisher's identity,
or assume white transparent lettering will be readable on a light Discord theme.
The catalog displays the wordmarks on dark surfaces. Text, status, counts and warnings
remain real message text; do not bake them into artwork.

The source folder contains no accompanying license or usage-terms document. These
owner-provided third-party materials retain their owners' rights and are excluded
from any future code license unless expressly stated otherwise. This repository does
not assert official endorsement or a general redistribution grant. See [NOTICE](../../NOTICE).

## Existing integration points

`src/discord/handler.ts` currently returns text, buttons and disabled mentions.
`src/discord/port.ts` forwards that response through the acknowledged interaction.
There is no live embed builder, attachment loader or media configuration in this slice.
The current Dockerfile also does not copy these catalog assets into the runtime image.
A later implementation must explicitly package or mount the reviewed files and extend
the response DTO; copying a URL into configuration does not activate graphics.

The smallest later implementation would add optional presentation to `/help` and
the already authorized `/server status` response. Keep the current Czech-first
language choice, ephemeral acknowledgement before IO, fresh membership checks and
escaped/bounded provider text. A graphic failure must retain a usable textual reply.
Do not add channel publishing, polling or a generic image URL option as a side effect.

The current `ServerStatus` contract contains server name, map, player count/capacity
and nullable match seconds. It has no cached observation timestamp or stale-state
model. The UNKNOWN/STALE fixtures below are proposed display states, not implemented
behavior. A later freshness feature needs a defined observation source and age policy.
An unavailable provider response must not become a fabricated zero-player or offline
result. An old sample must be visibly marked STALE with its actual observation time.
Never derive a map identifier or server location from a press-kit photograph.

## Illustrative attachment payloads

| Fixture                                                  | Purpose                                                   |
| -------------------------------------------------------- | --------------------------------------------------------- |
| [Help, Czech](examples/help-cs.json)                     | Czech introductory text and key art                       |
| [Help, English](examples/help-en.json)                   | Explicit English selection with the same artwork          |
| [Unknown status, Czech](examples/status-unknown-cs.json) | UNKNOWN without invented counts or a map                  |
| [Stale status, English](examples/status-stale-en.json)   | STALE with a clearly synthetic older sample and timestamp |

Each JSON document is an offline envelope, not an API request. `assetBindings` maps
an attachment ID and filename to an allowlisted repository path. `response` is the
illustrative message body; the actual local file bytes would separately accompany
it in multipart `files[n]` with matching attachment IDs. `attachment://filename`
alone does not upload a file. The examples use PNG/JPEG, descriptions for attachments,
and `allowed_mentions.parse: []`. Respect the interaction's actual
`attachment_size_limit` before any future upload. Discord documents this binding and
supported image extensions in its [file-upload reference](https://docs.discord.com/developers/reference#uploading-files).

For a future deferred reply, acknowledge ephemerally first and then edit that same
reply through the existing port. Do not copy a sample into a channel-message sender.
Preserve necessary attachment references when editing a message. Keep embed text
within Discord's [documented field and total limits](https://docs.discord.com/developers/resources/message#embed-limits),
and apply the existing text-safety policy to fields as well as message content.

The JSON examples deliberately contain no tokens, real member/server identifiers,
private player data, external image URLs or executable commands. Their stale counts
and timestamps are labeled invented demonstration data and must not be used as seeds
or health observations. These descriptions are reference data, not instructions to
register commands or send live messages.

## Inspect and verify

Serve the repository through a read-only loopback HTTP server and open
`docs/assets/presskit-preview.html`. The page loads its four JSON examples and four
bundled images from that same origin; it has no analytics or external requests. A
plain `file://` opening may block JSON loading. In that case the page shows a loading
error, not invented successful examples. The static asset catalog still opens locally.

Check the catalog with `node scripts/check-presskit.mjs`, then run the repository's
current `pnpm check:repository` and `pnpm format:check`. The focused checker tests and
preview renderer checks recorded in the PR establish their own scope. Review hash
agreement, allowed paths/formats, missing-file rejection, attachment bindings, Czech
diacritics, English selection, readable dark-background wordmarks and visible
UNKNOWN/STALE labels. Test a narrow viewport and blocked/outside-origin requests.

Capture the actual offline preview at the tested revision with the caption
**Offline press-kit catalog and embed proposal — not Discord**. Its imagery is a
design reference, not a screenshot of implemented bot embeds. Current lab transcripts
record only content/buttons; changing actual replies later also requires extending
the real serialized-message fixture and lab evidence before claiming embed coverage.
Actual Discord rendering, attachment delivery and ephemeral visibility remain in
[live acceptance](../live-acceptance.md) and follow the [evidence policy](../engineering/evidence.md).

The [captured offline review](evidence/presskit-2026-01/README.md) includes the portable
preview command, desktop/narrow screenshots and source/capture fingerprints.
