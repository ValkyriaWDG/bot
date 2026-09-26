# Security reporting

Do not publish credentials, private membership/player data or an exploitable production
configuration in an issue, PR, log or screenshot. Use the repository's private vulnerability
reporting in the GitHub Security tab when available. If it is unavailable, contact a
maintainer through an already established private channel and request a private reporting
route. Do not guess contact addresses or place sensitive details in a public request.

Include the affected revision, component, prerequisites, expected/observed behavior,
impact and a minimal safe reproduction with synthetic identities. Distinguish local
fixtures from confirmed live impact. Do not test against real guilds or game servers
without authorization. No response-time commitment is implied by this early release.

Priority boundaries are authorization freshness, actor/guild-bound one-use actions,
durable audit before dispatch, token/URL redaction, outbound allowlists, signed-message
replay/ordering and migration integrity. See the [design](docs/design.md) and
[service workflows](docs/engineering/service-workflows.md).

Maintainers should contain the affected capability, preserve sanitized evidence and
rotate exposed credentials through the operator's secret channel when authorized.
Never rewrite an unknown game action as successful or retry it as incident mitigation.
Verify recovery in the affected environment before resolving an incident; track
prevention work separately. Follow [the evidence policy](docs/engineering/evidence.md)
with sensitive material retained privately and only a sanitized public summary.
