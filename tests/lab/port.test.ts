import {
  Client,
  ChatInputCommandInteraction,
  ApplicationCommandType,
  InteractionType,
} from 'discord.js';
import { expect, it } from 'vitest';
import { portFor } from '../../src/discord/port.js';
import { apiMessage, createFixtures } from './fixtures.js';

it('binds real Discord button input to its actual source message and channel', async () => {
  const fixtures = await createFixtures();
  try {
    const message = apiMessage('Published match');
    const input = portFor(fixtures.button('vlk:signup:join:fixture:cs', message))?.input;
    expect(input).toMatchObject({
      kind: 'button',
      sourceMessageId: message.id,
      sourceChannelId: message.channel_id,
    });
  } finally {
    await fixtures.close();
  }
});

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
