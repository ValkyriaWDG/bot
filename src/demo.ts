// Synthetic proof only: no environment credentials, database or network connections.
import { readFile } from 'node:fs/promises';
import { parseConfig } from './config.js';
import { OperationsService } from './operations.js';
import { handleInteraction, type InteractionInput, type Response } from './discord/handler.js';
import type { ActionStore, Intent, Membership, ServerAction } from './contracts.js';

const config = parseConfig(JSON.parse(await readFile('config/bot.example.json', 'utf8')));
const server = config.servers[0]!;
const member: Membership = {
  guildId: config.guildId,
  userId: '777777777777777777',
  roleIds: [...new Set(Object.values(server.grants).flat())],
  state: 'present',
  observedAt: new Date().toISOString(),
};
const intents = new Map<string, Intent>();
const audit: string[] = [];
const dispatched: ServerAction[] = [];
const store: ActionStore = {
  createIntent: async (intent) => {
    intents.set(intent.id, structuredClone(intent));
    return true;
  },
  getIntent: async (id) => structuredClone(intents.get(id) ?? null),
  claimIntent: async (id, actor, now) => {
    const intent = intents.get(id);
    if (
      !intent ||
      intent.state !== 'pending' ||
      intent.userId !== actor.userId ||
      intent.guildId !== actor.guildId ||
      new Date(intent.expiresAt) <= now
    )
      return false;
    intent.state = 'executing';
    audit.push('dispatching');
    return true;
  },
  finishIntent: async (id, state, code) => {
    intents.get(id)!.state = state;
    audit.push(code);
  },
  cancelIntent: async () => false,
  audit: async (_actor, _action, _server, code) => {
    audit.push(code);
  },
};
const operations = new OperationsService(
  config,
  { fetch: async () => ({ ...member, observedAt: new Date().toISOString() }) },
  store,
  new Map([
    [
      server.id,
      {
        status: async () => ({
          serverName: 'SYNTHETIC Valkyria',
          map: 'Ozeti',
          playerCount: 2,
          maxPlayers: 100,
          matchSeconds: 42,
        }),
        players: async () => [],
        execute: async (action) => {
          dispatched.push(action);
        },
      },
    ],
  ]),
  true,
);
const transcript: { input: InteractionInput; response: Response }[] = [];
async function interact(input: InteractionInput) {
  await handleInteraction(
    {
      input,
      deferReply: async () => {},
      clearSourceComponents: async () => {},
      editReply: async (response) => {
        transcript.push({ input, response });
      },
    },
    { operations, config },
  );
}
const base = { guildId: config.guildId, userId: member.userId };
await interact({ ...base, id: 'demo-help', kind: 'command', commandName: 'help', options: {} });
await interact({
  ...base,
  id: 'demo-status',
  kind: 'command',
  commandName: 'server',
  subcommand: 'status',
  options: { server: server.id },
});
await interact({
  ...base,
  id: 'demo-preview',
  kind: 'command',
  commandName: 'admin',
  subcommand: 'restart',
  options: { server: server.id },
});
const intent = [...intents.values()][0]!;
await interact({
  ...base,
  id: 'demo-confirm',
  kind: 'button',
  customId: `confirm:${intent.id}:cs`,
});
await interact({
  ...base,
  id: 'demo-duplicate',
  kind: 'button',
  customId: `confirm:${intent.id}:cs`,
});
member.roleIds = [];
await interact({
  ...base,
  id: 'demo-revoked',
  kind: 'command',
  commandName: 'admin',
  subcommand: 'restart',
  options: { server: server.id },
});
if (dispatched.length !== 1 || !audit.includes('forbidden'))
  throw new Error('synthetic_demo_failed');
console.log(
  JSON.stringify(
    { evidence: 'SYNTHETIC_OFFLINE_NOT_LIVE_DISCORD', transcript, dispatched, audit },
    null,
    2,
  ),
);
