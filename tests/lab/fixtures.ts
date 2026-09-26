import { createServer, type Server, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client, ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import type { RoleSyncEvent } from '../../src/contracts.js';
import { verifySignedEvent, ROLE_SYNC_PATH } from '../../src/rolesync/signing.js';

export const IDS = {
  guild: '111111111111111111',
  application: '222222222222222222',
  role: '333333333333333333',
  member: '444444444444444444',
  outsider: '555555555555555555',
  channel: '666666666666666666',
  steam: '76561198000000001',
};
export const DISCORD_TOKEN = 'fixture-discord-token';
export const GAME_TOKEN = 'fixture-rcon-token';
export const SIGNING_SECRET = 'fixture-signing-secret-0000000000000000000';
export interface Wire {
  method: string;
  path: string;
  body: Record<string, unknown>;
}
const send = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};
const apiUser = (id: string) => ({
  id,
  username: id === IDS.application ? 'Valkyria LAB' : 'Synthetic member',
  discriminator: '0',
  avatar: null,
  bot: id === IDS.application,
});
export function apiMessage(content = '', components: unknown[] = []) {
  return {
    id: '777777777777777777',
    channel_id: IDS.channel,
    author: apiUser(IDS.application),
    content,
    timestamp: new Date().toISOString(),
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: 0,
    flags: 64,
    components,
  };
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

export async function createFixtures() {
  const discord: Wire[] = [],
    game: Wire[] = [];
  const roles = new Map<string, string[]>([
    [IDS.member, [IDS.role]],
    [IDS.outsider, []],
  ]);
  let membershipStatus = 200,
    rejectAcknowledgement = false,
    rejectCleanup = false,
    rejectReply = false;
  let gameMode: 'normal' | 'timeout' | 'accepted' | 'read-error' = 'normal';
  let sequence = 800000000000000000n;
  const discordServer = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const path = decodeURIComponent(new URL(request.url!, 'http://127.0.0.1').pathname);
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      discord.push({ method: request.method!, path, body });
      if (path.includes('/members/')) {
        if (membershipStatus !== 200)
          return send(
            response,
            {
              code: membershipStatus === 404 ? 10007 : 50013,
              message: 'Synthetic membership failure',
            },
            membershipStatus,
          );
        const user = path.split('/').at(-1)!;
        return send(response, {
          user: apiUser(user),
          roles: roles.get(user) ?? [],
          joined_at: '2026-01-01T00:00:00.000Z',
          deaf: false,
          mute: false,
        });
      }
      if (path.includes('/interactions/')) {
        if (rejectAcknowledgement)
          return send(response, { code: 50013, message: 'Synthetic acknowledgement failure' }, 403);
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'PATCH' && path.includes('/webhooks/')) {
        if (rejectReply && path.endsWith('/@original'))
          return send(response, { code: 50013, message: 'Synthetic reply failure' }, 403);
        if (rejectCleanup && !path.endsWith('/@original'))
          return send(response, { code: 50013, message: 'Synthetic cleanup failure' }, 403);
        return send(
          response,
          apiMessage(
            typeof body.content === 'string' ? body.content : '',
            Array.isArray(body.components) ? body.components : [],
          ),
        );
      }
      send(response, { code: 'unhandled_discord_fixture_route' }, 404);
    } catch {
      send(response, { code: 'fixture_error' }, 500);
    }
  });
  const gameServer = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const path = request.url!;
      game.push({
        method: request.method!,
        path,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      if (request.headers.authorization !== `Bearer ${GAME_TOKEN}`) return send(response, {}, 401);
      if (path === '/v1/status')
        return send(
          response,
          gameMode === 'read-error'
            ? { privateFixtureError: GAME_TOKEN }
            : {
                serverName: 'SYNTHETIC Valkyria @everyone',
                map: 'Europe',
                players: { current: 2, max: 100 },
                matchSeconds: 42,
              },
          gameMode === 'read-error' ? 503 : 200,
        );
      if (path === '/v1/players')
        return send(response, {
          players: [
            {
              steamId: IDS.steam,
              name: 'Synthetic Alpha @everyone',
              faction: 'RED',
              kills: 2,
              deaths: 1,
              pingMs: 25,
            },
            {
              steamId: null,
              name: 'Synthetic Bravo',
              faction: 'BLUE',
              kills: 1,
              deaths: 2,
              pingMs: 40,
            },
          ],
        });
      if (path === '/v1/capabilities')
        return send(response, {
          routes: [
            'POST /v1/broadcast',
            'POST /v1/players/{id}/kick',
            'POST /v1/bans',
            'DELETE /v1/bans/:steamId',
            'POST /v1/match/map',
            'POST /v1/match/restart',
          ],
        });
      if (path === '/v1/catalog/maps')
        return send(response, { maps: [{ id: 'Europe', displayName: 'Europe' }] });
      if (gameMode === 'timeout') return; // Accepted request bytes, then deliberately lost response.
      if (gameMode === 'accepted') {
        response.writeHead(202).end();
        return;
      }
      send(response, { message: 'Synthetic server accepted request' });
    } catch {
      send(response, { code: 'fixture_error' }, 500);
    }
  });
  const receiver = {
    nonces: new Set<string>(),
    eventIds: new Set<string>(),
    state: null as RoleSyncEvent | null,
    accepted: 0,
    duplicates: 0,
    stale: 0,
    lastEnvelope: null as null | { headers: Record<string, string>; body: string },
  };
  const websiteServer = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
      const canonical = [
        request.method,
        request.url,
        headers['x-valkyria-key-id'],
        headers['x-valkyria-timestamp'],
        headers['x-valkyria-nonce'],
        body,
      ].join('\n');
      const expected = createHmac('sha256', SIGNING_SECRET).update(canonical, 'utf8').digest();
      const supplied = Buffer.from(headers['x-valkyria-signature'] ?? '', 'hex');
      if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
        throw new Error('fixture_independent_hmac_mismatch');
      const event = verifySignedEvent({
        method: request.method!,
        path: request.url!,
        headers,
        body,
        guildId: IDS.guild,
        keys: { lab: SIGNING_SECRET },
      });
      const nonce = headers['x-valkyria-nonce']!;
      receiver.lastEnvelope = { headers, body };
      if (receiver.nonces.has(nonce) || receiver.eventIds.has(event.eventId)) {
        receiver.duplicates++;
        return send(response, { code: 'DUPLICATE_EVENT', eventId: event.eventId }, 409);
      }
      receiver.nonces.add(nonce);
      receiver.eventIds.add(event.eventId);
      if (receiver.state && BigInt(event.sequence) <= BigInt(receiver.state.sequence)) {
        receiver.stale++;
        return send(response, { code: 'STALE_EVENT', eventId: event.eventId }, 409);
      }
      receiver.state = event;
      receiver.accepted++;
      response.writeHead(204).end();
    } catch {
      send(response, { code: 'INVALID_SIGNED_EVENT' }, 401);
    }
  });
  try {
    const discordUrl = await listen(discordServer),
      gameUrl = await listen(gameServer),
      websiteUrl = `${await listen(websiteServer)}${ROLE_SYNC_PATH}`;
    const client = new Client({
      intents: [],
      rest: {
        api: discordUrl,
        version: '10',
        timeout: 1500,
        retries: 0,
        globalRequestsPerSecond: 1000,
        rejectOnRateLimit: () => true,
      },
      allowedMentions: { parse: [] },
    });
    client.rest.setToken(DISCORD_TOKEN);
    function packet(userId = IDS.member, guildId = IDS.guild) {
      const id = String(++sequence);
      return {
        id,
        application_id: IDS.application,
        token: `fixture-interaction-${id}`,
        version: 1,
        guild_id: guildId,
        locale: 'cs',
        entitlements: [],
        authorizing_integration_owners: {},
        attachment_size_limit: 10485760,
        channel: { id: IDS.channel, type: 0 },
        member: {
          user: apiUser(userId),
          roles: roles.get(userId) ?? [],
          permissions: '0',
          joined_at: '2026-01-01T00:00:00.000Z',
          deaf: false,
          mute: false,
        },
      };
    }
    return {
      discord,
      game,
      roles,
      receiver,
      client,
      gameUrl,
      websiteUrl,
      setMembershipStatus: (value: number) => {
        membershipStatus = value;
      },
      setRejectAcknowledgement: (value: boolean) => {
        rejectAcknowledgement = value;
      },
      setRejectCleanup: (value: boolean) => {
        rejectCleanup = value;
      },
      setRejectReply: (value: boolean) => {
        rejectReply = value;
      },
      setGameMode: (value: typeof gameMode) => {
        gameMode = value;
      },
      command(
        name: string,
        subcommand?: string,
        options: Record<string, string> = {},
        userId = IDS.member,
        guildId = IDS.guild,
      ) {
        const values = Object.entries(options).map(([name, value]) => ({ type: 3, name, value }));
        const data = {
          ...packet(userId, guildId),
          type: 2,
          data: {
            id: '999999999999999999',
            type: 1,
            name,
            options: subcommand ? [{ type: 1, name: subcommand, options: values }] : values,
          },
        };
        return Reflect.construct(ChatInputCommandInteraction, [
          client,
          data,
        ]) as ChatInputCommandInteraction;
      },
      button(
        customId: string,
        source: ReturnType<typeof apiMessage>,
        userId = IDS.member,
        guildId = IDS.guild,
      ) {
        const data = {
          ...packet(userId, guildId),
          type: 3,
          data: { component_type: 2, custom_id: customId },
          message: source,
        };
        return Reflect.construct(ButtonInteraction, [client, data]) as ButtonInteraction;
      },
      async close() {
        await client.destroy();
        await Promise.all([close(discordServer), close(gameServer), close(websiteServer)]);
      },
    };
  } catch (error) {
    await Promise.all([close(discordServer), close(gameServer), close(websiteServer)]);
    throw error;
  }
}
