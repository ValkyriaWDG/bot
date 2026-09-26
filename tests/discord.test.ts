import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { Actor, BotConfig, ServerAction } from '../src/contracts.js';
import { BotError } from '../src/errors.js';
import { buildCommands } from '../src/discord/commands.js';
import {
  handleInteraction,
  type InteractionInput,
  type InteractionPort,
  type OperationsPort,
  type Response,
} from '../src/discord/handler.js';

const config: BotConfig = {
  guildId: '111111111111111111',
  applicationId: '222222222222222222',
  defaultLocale: 'cs',
  websiteUrl: 'https://valkyriawdg.cz',
  servers: [
    {
      id: 'primary',
      label: 'Valkyria',
      baseUrl: 'https://rcon.example.invalid',
      tokenEnv: 'TEST_TOKEN',
      grants: {},
    },
  ],
  roleSync: {
    enabled: false,
    url: 'https://valkyriawdg.cz/api/integrations/discord/role-sync',
    keyId: 'test',
    secretEnv: 'TEST_SYNC',
    reconcileSeconds: 60,
  },
};
const actor: Actor = { guildId: config.guildId, userId: '333333333333333333' };
const intentId = 'e27c3a90-a8ea-4a8c-a101-a858dd401320';
function command(
  name: string,
  subcommand?: string,
  options: Record<string, string> = {},
): InteractionInput {
  return {
    kind: 'command',
    id: '444444444444444444',
    ...actor,
    commandName: name,
    options,
    ...(subcommand === undefined ? {} : { subcommand }),
  };
}
function harness(input: InteractionInput, overrides: Partial<OperationsPort> = {}) {
  const events: string[] = [];
  const replies: Response[] = [];
  const captured: { actor?: Actor; action?: ServerAction } = {};
  const operations: OperationsPort = {
    account: async () => {
      events.push('account');
      return {
        member: {
          ...actor,
          roleIds: ['private-role'],
          state: 'present',
          observedAt: '2026-09-26T10:00:00Z',
        },
        capabilities: { primary: ['server.status'] },
      };
    },
    status: async () => {
      events.push('status');
      return {
        serverName: '@everyone **secret**',
        map: 'Ozeti',
        playerCount: 4,
        maxPlayers: 100,
        matchSeconds: 120,
      };
    },
    players: async () => {
      events.push('players');
      return Array.from({ length: 21 }, (_, i) => ({
        steamId: `76561190000000${i}`,
        name: i === 0 ? '@everyone **spoof**\nFORGED' : `Player ${i + 1}`,
        faction: 'team',
        kills: 1,
        deaths: 2,
        pingMs: 20,
      }));
    },
    preview: async (who, interactionId, serverId, action) => {
      events.push('preview');
      captured.actor = who;
      captured.action = action;
      return {
        ...who,
        id: intentId,
        interactionId,
        serverId,
        action,
        state: 'pending',
        expiresAt: '2026-09-26T10:01:00Z',
      };
    },
    confirm: async (who) => {
      events.push('confirm');
      captured.actor = who;
      return 'succeeded';
    },
    cancel: async (who) => {
      events.push('cancel');
      captured.actor = who;
      return true;
    },
    ...overrides,
  };
  const port: InteractionPort = {
    input,
    deferReply: async (payload) => {
      expect(payload.flags).toBe(MessageFlags.Ephemeral);
      events.push('defer');
    },
    editReply: async (payload) => {
      replies.push(payload);
      events.push('reply');
    },
    clearSourceComponents: async () => {
      events.push('clear');
    },
  };
  return { port, operations, events, replies, captured };
}

describe('command registration manifest', () => {
  it('defines only guild operations with restricted admin, localized descriptions and bounded configured targets', () => {
    const commands = buildCommands(config);
    expect(commands.map((entry) => entry.name)).toEqual(['help', 'account', 'server', 'admin']);
    const admin = commands.find((entry) => entry.name === 'admin')!;
    expect(admin.default_member_permissions).toBe('0');
    expect(admin.options?.map((option) => option.name)).toEqual([
      'broadcast',
      'kick',
      'ban',
      'unban',
      'map',
      'restart',
    ]);
    const status = commands.find((entry) => entry.name === 'server')!.options![0]!;
    expect(status.description).toMatch(/stav/i);
    expect(status.description_localizations?.['en-US']).toMatch(/status/i);
    if ('options' in status) {
      expect(status.options?.find((option) => option.name === 'server')).toMatchObject({
        choices: [{ name: 'Valkyria', value: 'primary' }],
        required: true,
      });
      expect(status.options?.find((option) => option.name === 'language')).toMatchObject({
        required: false,
        choices: [
          { name: 'Čeština', value: 'cs' },
          { name: 'English', value: 'en' },
        ],
      });
    }
    expect(() =>
      buildCommands({
        ...config,
        servers: Array.from({ length: 26 }, (_, i) => ({
          ...config.servers[0]!,
          id: `server-${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe('interaction application boundary', () => {
  it('rejects foreign guilds without invoking a service operation', async () => {
    const h = harness({
      ...command('server', 'status', { server: 'primary' }),
      guildId: 'another-guild',
    });
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
    expect(h.replies[0]?.content).toMatch(/serveru Discord/i);
  });
  it('acknowledges privately before status IO and escapes untrusted text', async () => {
    const h = harness(command('server', 'status', { server: 'primary' }));
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'status', 'reply']);
    expect(h.replies[0]?.content).toContain('Stav serveru');
    expect(h.replies[0]?.content).not.toContain('@everyone');
    expect(h.replies[0]?.content).not.toContain('**secret**');
    expect(h.replies[0]?.allowedMentions).toEqual({ parse: [] });
  });
  it('uses English only when explicitly selected and never displays private membership role IDs', async () => {
    const h = harness(command('account', undefined, { language: 'en' }));
    await handleInteraction(h.port, {
      config,
      operations: h.operations,
      onAccountRefresh: async () => {
        h.events.push('sync');
      },
    });
    expect(h.events).toEqual(['defer', 'account', 'sync', 'reply']);
    expect(h.replies[0]?.content).toContain('Account');
    expect(h.replies[0]?.content).not.toContain('private-role');
    expect(h.replies[0]?.content).toContain('server.status');
  });
  it('caps the player display without leaking platform IDs or forged newlines', async () => {
    const h = harness(command('server', 'players', { server: 'primary' }));
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.replies[0]?.content).toMatch(/20.*21/);
    expect(h.replies[0]?.content).not.toContain('Player 21');
    expect(h.replies[0]?.content).not.toContain('7656119');
    expect(h.replies[0]?.content).not.toContain('\nFORGED');
    expect(h.replies[0]!.content.length).toBeLessThanOrEqual(2000);
  });
  it('shows help without operational IO or claiming web account linkage', async () => {
    const h = harness(command('help'));
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
    expect(h.replies[0]?.content).toContain('/server status');
    expect(h.replies[0]?.content).toContain('https://valkyriawdg.cz');
  });
  it('preserves fresh account results when optional role synchronization is unavailable', async () => {
    const h = harness(command('account', undefined, { language: 'en' }));
    await handleInteraction(h.port, {
      config: { ...config, roleSync: { ...config.roleSync, enabled: true } },
      operations: h.operations,
      onAccountRefresh: async () => {
        throw new Error('secret sync URL');
      },
    });
    expect(h.replies[0]?.content).toContain('Account');
    expect(h.replies[0]?.content).toMatch(/synchronization.*unavailable/i);
    expect(h.replies[0]?.content).not.toMatch(/pending|queued/i);
    expect(h.replies[0]?.content).not.toContain('secret sync URL');
  });
  it('reports pending delivery only after the refresh callback confirms durable enqueue', async () => {
    const h = harness(command('account', undefined, { language: 'en' }));
    await handleInteraction(h.port, {
      config: { ...config, roleSync: { ...config.roleSync, enabled: true } },
      operations: h.operations,
      onAccountRefresh: async () => {
        h.events.push('queued');
      },
    });
    expect(h.events).toEqual(['defer', 'account', 'queued', 'reply']);
    expect(h.replies[0]?.content).toMatch(/pending/i);
    expect(h.replies[0]?.content).not.toMatch(/synchronization.*unavailable/i);
  });
  it('does not claim queued synchronization when no refresh adapter is configured', async () => {
    const h = harness(command('account', undefined, { language: 'en' }));
    await handleInteraction(h.port, {
      config: { ...config, roleSync: { ...config.roleSync, enabled: true } },
      operations: h.operations,
    });
    expect(h.replies[0]?.content).toMatch(/synchronization.*unavailable/i);
    expect(h.replies[0]?.content).not.toMatch(/pending|queued/i);
  });
  it('preserves Czech account output while explaining failed synchronization honestly', async () => {
    const h = harness(command('account'));
    await handleInteraction(h.port, {
      config: { ...config, roleSync: { ...config.roleSync, enabled: true } },
      operations: h.operations,
      onAccountRefresh: async () => {
        throw new Error('private transport detail');
      },
    });
    expect(h.replies[0]?.content).toMatch(/Účet.*oprávnění/);
    expect(h.replies[0]?.content).toMatch(/Synchronizace.*nedostupná/);
    expect(h.replies[0]?.content).not.toMatch(/čeká|private transport detail/);
  });
  it.each([
    {
      sub: 'broadcast',
      options: { message: 'Hello clan' },
      action: { type: 'broadcast', message: 'Hello clan' },
    },
    {
      sub: 'ban',
      options: { steam_id: '76561190000000000', reason: 'Cheating' },
      action: { type: 'ban', steamId: '76561190000000000', reason: 'Cheating' },
    },
    {
      sub: 'unban',
      options: { steam_id: '76561190000000000' },
      action: { type: 'unban', steamId: '76561190000000000' },
    },
    { sub: 'map', options: { map: 'Ozeti' }, action: { type: 'map', map: 'Ozeti' } },
    { sub: 'restart', options: {}, action: { type: 'restart' } },
  ])('maps $sub to the allowlisted service action', async ({ sub, options, action }) => {
    const h = harness(
      command('admin', sub, { server: 'primary', ...options } as Record<string, string>),
    );
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'preview', 'reply']);
    expect(h.captured.action).toEqual(action);
  });
  it('previews the exact action and creates opaque one-use buttons without executing it', async () => {
    const h = harness(
      command('admin', 'kick', {
        server: 'primary',
        steam_id: '76561190000000000',
        reason: 'Team killing',
      }),
    );
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'preview', 'reply']);
    expect(h.captured.action).toEqual({
      type: 'kick',
      steamId: '76561190000000000',
      reason: 'Team killing',
    });
    expect(h.replies[0]?.content).toContain('76561190000000000');
    expect(h.replies[0]?.components[0]?.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ custom_id: `confirm:${intentId}:cs` }),
        expect.objectContaining({ custom_id: `cancel:${intentId}:cs` }),
      ]),
    );
  });
  it.each(['succeeded', 'failed', 'unknown'] as const)(
    'removes the original controls after a consumed confirmation returns %s',
    async (outcome) => {
      const h = harness(
        { kind: 'button', id: 'button-id', ...actor, customId: `confirm:${intentId}:en` },
        {
          confirm: async () => {
            return outcome;
          },
        },
      );
      await handleInteraction(h.port, { config, operations: h.operations });
      expect(h.events).toEqual(['defer', 'clear', 'reply']);
      expect(h.replies[0]?.components).toEqual([]);
      if (outcome === 'unknown') expect(h.replies[0]?.content).toMatch(/unknown.*retry/i);
      if (outcome === 'succeeded') {
        expect(h.replies[0]?.content).toMatch(/server accepted.*verify/i);
        expect(h.replies[0]?.content).not.toMatch(/operation completed/i);
      }
    },
  );
  it('does not disable the owner confirmation when an unauthorized actor is rejected', async () => {
    const h = harness(
      { kind: 'button', id: 'button-id', ...actor, customId: `confirm:${intentId}:cs` },
      {
        confirm: async () => {
          throw new BotError('forbidden');
        },
      },
    );
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
    expect(h.replies[0]?.content).toMatch(/oprávnění/i);
  });
  it('explains consumed or expired confirmation without disabling another message', async () => {
    const h = harness(
      { kind: 'button', id: 'button-id', ...actor, customId: `confirm:${intentId}:en` },
      {
        confirm: async () => {
          throw new BotError('invalid_confirmation');
        },
      },
    );
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
    expect(h.replies[0]?.content).toMatch(/no longer valid/i);
  });
  it('does not remove controls when cancellation is rejected by the actor-bound store', async () => {
    const h = harness(
      { kind: 'button', id: 'button-id', ...actor, customId: `cancel:${intentId}:en` },
      { cancel: async () => false },
    );
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
    expect(h.replies[0]?.content).toMatch(/no longer valid/i);
  });
  it('cancels through the actor-bound service without calling confirm', async () => {
    const h = harness({
      kind: 'button',
      id: 'button-id',
      ...actor,
      customId: `cancel:${intentId}:cs`,
    });
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'cancel', 'clear', 'reply']);
    expect(h.captured.actor).toEqual(actor);
  });
  it.each([
    command('admin', 'restart', { server: 'not-configured' }),
    command('admin', 'shell', { server: 'primary', command: 'whoami' }),
    command('admin', 'kick', { server: 'primary' }),
    command('admin', 'broadcast', { server: 'primary', message: 'x'.repeat(201) }),
    command('admin', 'ban', {
      server: 'primary',
      steam_id: '76561190000000000',
      reason: 'x'.repeat(201),
    }),
    command('server', 'status', { server: 'primary', language: 'xx' }),
    { kind: 'button' as const, id: 'button-id', ...actor, customId: 'confirm:forged-value:cs' },
  ])('rejects malformed/unknown input before operational IO', async (input) => {
    const h = harness(input);
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'reply']);
  });
  it('never echoes unexpected exception details or unknown error codes', async () => {
    const h = harness(command('server', 'status', { server: 'primary' }), {
      status: async () => {
        throw new BotError('secret https://private.example/token');
      },
    });
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.replies[0]?.content).not.toMatch(/secret|private|token/);
    expect(h.replies[0]?.content).toMatch(/dokončit/i);
  });
  it('does not start operations when Discord acknowledgement fails', async () => {
    const h = harness(command('server', 'status', { server: 'primary' }));
    h.port.deferReply = async () => {
      throw new Error('Discord unavailable');
    };
    await expect(handleInteraction(h.port, { config, operations: h.operations })).rejects.toThrow(
      'Discord unavailable',
    );
    expect(h.events).toEqual([]);
  });
  it('keeps a consumed control outcome even if clearing the old button fails', async () => {
    const h = harness({
      kind: 'button',
      id: 'button-id',
      ...actor,
      customId: `confirm:${intentId}:en`,
    });
    h.port.clearSourceComponents = async () => {
      throw new Error('message inaccessible');
    };
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.events).toEqual(['defer', 'confirm', 'reply']);
    expect(h.replies[0]?.content).toMatch(/server accepted.*verify/i);
  });
  it('describes a Czech successful acknowledgement without claiming a verified game effect', async () => {
    const h = harness({
      kind: 'button',
      id: 'button-id',
      ...actor,
      customId: `confirm:${intentId}:cs`,
    });
    await handleInteraction(h.port, { config, operations: h.operations });
    expect(h.replies[0]?.content).toMatch(/Server přijal požadavek.*Ověřte/);
    expect(h.replies[0]?.content).not.toMatch(/byl dokončen/);
  });
});
