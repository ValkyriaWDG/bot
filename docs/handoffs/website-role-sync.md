# Website integration handoff

Use this task in the separately owned `ValkyriaWDG/www` repository after its current
work is ready for this integration. This is a proposed contract, not a claim that the
receiver already exists. Do not edit the bot repository from the website task.

Implement and test the receiving side of the bot's version-1 Discord role synchronization
contract in [web-integration.md](../web-integration.md), including its exact signed byte
format, acknowledgement semantics, immutable event identity and observation timestamp.
First compare it with the website's existing architecture and auth contract. Resolve any
incompatibility explicitly in both contracts before enabling delivery; do not silently
accept multiple ambiguous signature formats.

The website continues to own Discord OAuth, sessions, legacy admin recovery and its
permission policy. Bot events invalidate or reduce cached authority; they do not create
sessions or grant new permissions without fresh server-side Discord verification.

Persist event replay and ordering decisions transactionally before acknowledgement.
Test duplicate concurrent delivery, older-present after newer-departed, stale observation
with a fresh retry signature, wrong guild, unknown key, expired envelope, tampered bytes,
oversized input, receiver outages and key rotation. Preserve decimal snowflakes and
sequences as strings. Never log signed headers, secrets or full member payloads.

Deliver a scoped PR with current-revision tests and actual feature evidence. Keep
[bot issue #5](https://github.com/ValkyriaWDG/bot/issues/5) and the matching website live
acceptance open until the real sender and receiver have been tested together. Production
secrets and enablement are separate operator work; the bot ships with delivery disabled.
