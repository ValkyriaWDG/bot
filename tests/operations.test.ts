import { beforeEach, describe, expect, it } from 'vitest';
import { OperationsService } from '../src/operations.js';
import type { BotConfig, GameServer, Membership, ServerAction } from '../src/contracts.js';
import { MemoryActions } from './support.js';

const actor = { guildId: '111111111111111111', userId: '444444444444444444' };
const time = new Date('2026-09-26T12:00:00Z');
const config: BotConfig = {
  guildId: actor.guildId,
  applicationId: '222222222222222222',
  defaultLocale: 'cs',
  websiteUrl: 'https://valkyriawdg.cz',
  servers: [
    {
      id: 'primary',
      label: 'Test',
      baseUrl: 'https://example.invalid',
      tokenEnv: 'TEST_TOKEN',
      grants: { 'server.control': ['333333333333333333'], 'server.status': ['333333333333333333'] },
    },
  ],
  roleSync: {
    enabled: false,
    url: 'https://valkyriawdg.cz/api/integrations/discord/role-sync',
    keyId: 'primary',
    secretEnv: 'TEST_SYNC',
    reconcileSeconds: 60,
  },
};
describe('authorized one-use server operations', () => {
  let member: Membership;
  let clock: Date;
  let store: MemoryActions;
  let sent: ServerAction[];
  let operations: OperationsService;
  let game: GameServer;
  beforeEach(() => {
    clock = new Date(time);
    member = {
      ...actor,
      roleIds: ['333333333333333333'],
      state: 'present',
      observedAt: time.toISOString(),
    };
    store = new MemoryActions();
    sent = [];
    game = {
      status: async () => ({
        serverName: 'Test',
        map: 'Ozeti',
        playerCount: 2,
        maxPlayers: 100,
        matchSeconds: 15,
      }),
      players: async () => [],
      execute: async (action) => {
        sent.push(action);
      },
    };
    operations = new OperationsService(
      config,
      { fetch: async () => structuredClone(member) },
      store,
      new Map([['primary', game]]),
      true,
      () => clock,
    );
  });
  it('previews without dispatch and confirms a saved action exactly once', async () => {
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    expect(sent).toEqual([]);
    expect(await operations.confirm(actor, intent.id)).toBe('succeeded');
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('invalid_confirmation');
    expect(sent).toEqual([{ type: 'restart' }]);
    expect(store.events).toContainEqual({ action: 'restart', code: 'dispatching' });
  });
  it('revoked roles between preview and confirmation deny control', async () => {
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    member.roleIds = [];
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('forbidden');
    expect(sent).toEqual([]);
  });
  it('binds confirmations to guild and actor, expires them, and cancels without execution', async () => {
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    await expect(
      operations.confirm({ ...actor, userId: '555555555555555555' }, intent.id),
    ).rejects.toThrow('invalid_confirmation');
    await expect(
      operations.confirm({ ...actor, guildId: '555555555555555555' }, intent.id),
    ).rejects.toThrow('wrong_guild');
    clock = new Date(time.getTime() + 61_000);
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('invalid_confirmation');
    expect(await operations.cancel(actor, intent.id)).toBe(true);
    expect(sent).toEqual([]);
  });
  it('parallel double-click dispatches at most once', async () => {
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    const outcomes = await Promise.allSettled([
      operations.confirm(actor, intent.id),
      operations.confirm(actor, intent.id),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
  it('rejects stale, cross-user or departed membership as authority', async () => {
    member.observedAt = new Date(time.getTime() - 61_000).toISOString();
    await expect(operations.status(actor, 'primary')).rejects.toThrow('membership_unavailable');
    member = { ...member, observedAt: time.toISOString(), userId: '555555555555555555' };
    await expect(operations.status(actor, 'primary')).rejects.toThrow('membership_unavailable');
    member = { ...member, ...actor, state: 'left' };
    await expect(operations.status(actor, 'primary')).rejects.toThrow('forbidden');
  });
  it('disabled writes and missing grants never prepare an executable intent', async () => {
    const disabled = new OperationsService(
      config,
      { fetch: async () => member },
      store,
      new Map([['primary', game]]),
      false,
      () => clock,
    );
    await expect(
      disabled.preview(actor, 'interaction-1', 'primary', { type: 'restart' }),
    ).rejects.toThrow('writes_disabled');
    await expect(
      operations.preview(actor, 'interaction-2', 'primary', {
        type: 'kick',
        steamId: '76561198000000000',
        reason: 'test',
      }),
    ).rejects.toThrow('forbidden');
    expect(store.intents.size).toBe(0);
  });
  it('does not retry ambiguous dispatch failures and stores unknown outcome', async () => {
    game.execute = async (action) => {
      sent.push(action);
      throw new Error('secret upstream failure');
    };
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    expect(await operations.confirm(actor, intent.id)).toBe('unknown');
    expect((await store.getIntent(intent.id))?.state).toBe('unknown');
    expect(JSON.stringify(store.events)).not.toContain('secret');
    expect(sent).toHaveLength(1);
  });
  it('fails closed when audit persistence fails before dispatch', async () => {
    const intent = await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    store.claimIntent = async () => {
      throw new Error('database unavailable');
    };
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('storage_unavailable');
    expect(sent).toEqual([]);
  });
  it('duplicate initial interaction cannot create a second confirmation', async () => {
    await operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' });
    await expect(
      operations.preview(actor, 'interaction-1', 'primary', { type: 'restart' }),
    ).rejects.toThrow('duplicate_interaction');
    expect(store.intents.size).toBe(1);
  });
  it('reauthorizes after a database claim wait before any external dispatch', async () => {
    const intent = await operations.preview(actor, 'delayed-claim', 'primary', { type: 'restart' });
    const claim = store.claimIntent.bind(store);
    store.claimIntent = async (id, actor, now) => {
      const result = await claim(id, actor, now);
      member.roleIds = [];
      return result;
    };
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('forbidden');
    expect(sent).toEqual([]);
    expect((await store.getIntent(intent.id))?.state).toBe('failed');
  });
  it('rejects a confirmation that expires during its database claim', async () => {
    const intent = await operations.preview(actor, 'expired-claim', 'primary', { type: 'restart' });
    const claim = store.claimIntent.bind(store);
    store.claimIntent = async (id, actor, now) => {
      const result = await claim(id, actor, now);
      clock = new Date(time.getTime() + 61_000);
      member.observedAt = clock.toISOString();
      return result;
    };
    await expect(operations.confirm(actor, intent.id)).rejects.toThrow('invalid_confirmation');
    expect(sent).toEqual([]);
    expect((await store.getIntent(intent.id))?.state).toBe('failed');
  });
});
