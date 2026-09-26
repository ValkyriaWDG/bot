---
name: valkyria-discord
description: Implement or review Valkyria slash commands, Czech-first replies, safe confirmation UX and the Discord runtime interaction boundary.
---

# Discord commands and responses

Read [the command contract](../../../docs/commands.md),
[Discord workflow](../../../docs/engineering/service-workflows.md#discord-presentation),
[manifest](../../../src/discord/commands.ts), [handler](../../../src/discord/handler.ts)
and [dispatcher tests](../../../tests/discord.test.ts).

1. Specify command/options and success, denial, expiry and unknown-outcome states.
   Names stay English; descriptions/replies default to Czech, with documented explicit
   English selection. Preserve locale on confirmation buttons.
2. Defer ephemerally before IO, suppress mentions and escape/bound untrusted text.
   Reject foreign guilds and unknown targets. Never expose platform IDs in the player list.
3. Keep authorization in the operations service. Admin visibility/default permissions
   are only a Discord filter; saved intents and fresh roles decide execution. Buttons
   reference the persisted operation, not user-supplied commands or URLs.
4. Test the real manifest/dispatcher through its narrow port. Cover acknowledgement
   failure, hostile names, locale choice, rejected actors and consumed outcomes when
   message cleanup fails. Do not fake Discord internals to claim live behavior.
5. Inspect the offline manifest with `pnpm commands:register` without apply flags.
   Registration is a separate authorized operation, never startup behavior. Deliver
   [captioned live screenshots when applicable](../../../docs/engineering/evidence.md);
   leave actual rendering/privacy/button acceptance pending until live access is authorized.

Return the changed command contract, exact checks and evidence limitations. A failed
button edit must not replay a server mutation or overwrite its durable outcome.
