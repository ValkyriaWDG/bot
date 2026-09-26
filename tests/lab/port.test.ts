import {
  Client,
  ChatInputCommandInteraction,
  ApplicationCommandType,
  InteractionType,
} from 'discord.js';
import { expect, it } from 'vitest';
import { portFor } from '../../src/discord/port.js';

it('adapts real Discord command option resolution without changing the production input', async () => {
  const client = new Client({ intents: [] });
  try {
    const interaction = Reflect.construct(ChatInputCommandInteraction, [
      client,
      {
        id: '111111111111111111',
        application_id: '222222222222222222',
        type: InteractionType.ApplicationCommand,
        token: 'fixture-only',
        version: 1,
        guild_id: '333333333333333333',
        locale: 'cs',
        entitlements: [],
        authorizing_integration_owners: {},
        attachment_size_limit: 10485760,
        user: {
          id: '444444444444444444',
          username: 'Synthetic member',
          discriminator: '0',
          avatar: null,
        },
        data: {
          id: '555555555555555555',
          type: ApplicationCommandType.ChatInput,
          name: 'server',
          options: [
            {
              type: 1,
              name: 'status',
              options: [
                { type: 3, name: 'server', value: 'primary' },
                { type: 3, name: 'language', value: 'en' },
              ],
            },
          ],
        },
      },
    ]) as ChatInputCommandInteraction;
    expect(portFor(interaction)?.input).toMatchObject({
      kind: 'command',
      commandName: 'server',
      subcommand: 'status',
      userId: '444444444444444444',
      guildId: '333333333333333333',
      options: { server: 'primary', language: 'en' },
    });
  } finally {
    await client.destroy();
  }
});
