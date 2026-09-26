import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../src/contracts.js';
import type { InteractionInput, InteractionPort, Response } from '../src/discord/handler.js';
import { handleSignup, type SignupDependencies } from '../src/signup/handler.js';
import type { SignupCommand, SignupRequest } from '../src/signup/contracts.js';
import { WebsiteError } from '../src/website/client.js';

const publicationId = '51f23b67-655e-438c-a86e-5096edb7ae01';
const matchId = 'a6c1e842-3edc-4d6c-851f-a2e94466d04c';
const now = new Date('2026-09-26T12:00:00Z');
const input = {
  kind: 'button' as const,
  id: '333333333333333333',
  guildId: '111111111111111111',
  userId: '222222222222222222',
  sourceChannelId: '444444444444444444',
  sourceMessageId: '555555555555555555',
  customId: `vlk:signup:join:${publicationId}:cs`,
};
const member: Membership = {
  guildId: input.guildId,
  userId: input.userId,
  roleIds: ['666666666666666666'],
  state: 'present',
  observedAt: now.toISOString(),
};
function harness(change: Partial<typeof input> = {}) {
  const calls: string[] = [];
  const replies: Response[] = [];
  const commands: SignupCommand[] = [];
  const deps: SignupDependencies = {
    guildId: input.guildId,
    defaultLocale: 'cs',
    websiteOrigin: 'https://valkyriawdg.cz',
    now: () => now,
    membership: {
      fetch: async () => {
        calls.push('member');
        return member;
      },
    },
    website: {
      context: async (request: SignupRequest) => {
        calls.push('context');
        return {
          schemaVersion: 1,
          request,
          state: 'ready',
          matchId,
          revision: '4',
          signup: 'open',
          participation: 'none',
        };
      },
      participate: async (command: SignupCommand) => {
        calls.push('mutate');
        commands.push(command);
        return {
          schemaVersion: 1,
          command,
          status: 'committed',
          participation: command.action === 'join' ? 'joined' : 'withdrawn',
          revision: '5',
          committedAt: now.toISOString(),
        };
      },
    },
  };
  const port: InteractionPort = {
    input: { ...input, ...change } as InteractionInput,
    deferReply: async (options) => {
      expect(options.flags).toBe(MessageFlags.Ephemeral);
      calls.push('defer');
    },
    editReply: async (response) => {
      replies.push(response);
      calls.push('reply');
    },
    clearSourceComponents: async () => {
      throw Error('must not clear shared controls');
    },
  };
  return { deps, port, calls, replies, commands };
}
describe('website-owned signup bridge', () => {
  it('defers before IO, binds actual source and actor, reauthorizes before committed join', async () => {
    const h = harness();
    await handleSignup(h.port, h.deps);
    expect(h.calls).toEqual(['defer', 'member', 'context', 'member', 'mutate', 'reply']);
    expect(h.commands[0]).toEqual({
      schemaVersion: 1,
      publicationId,
      locale: 'cs',
      guildId: input.guildId,
      userId: input.userId,
      interactionId: input.id,
      channelId: input.sourceChannelId,
      messageId: input.sourceMessageId,
      action: 'join',
      expectedRevision: '4',
      idempotencyKey: `${input.guildId}:${input.userId}:${input.id}`,
    });
    expect(h.replies[0]!.content).toContain('přihlášení');
    expect(h.replies[0]!.allowedMentions).toEqual({ parse: [] });
  });
  it('does zero IO after a rejected private acknowledgement', async () => {
    const h = harness();
    h.port.deferReply = async () => {
      throw Error('unavailable');
    };
    await expect(handleSignup(h.port, h.deps)).rejects.toThrow('unavailable');
    expect(h.calls).toEqual([]);
  });
  it.each([
    { guildId: '999999999999999999' },
    { sourceMessageId: '' },
    { sourceChannelId: '' },
    { customId: `vlk:signup:admin:${publicationId}:cs` },
    { customId: 'vlk:signup:join:../../:en' },
  ])('rejects hostile/wrong source before IO: %j', async (change) => {
    const h = harness(change);
    await handleSignup(h.port, h.deps);
    expect(h.calls).toEqual(['defer', 'reply']);
  });
  it.each([
    { state: 'left' as const },
    { userId: '999999999999999999' },
    { guildId: '999999999999999999' },
    { observedAt: '2026-09-26T11:58:00Z' },
    { observedAt: '2026-09-26T12:01:00Z' },
  ])('denies invalid/stale membership %j', async (change) => {
    const h = harness();
    h.deps.membership.fetch = async () => ({ ...member, ...change });
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
    expect(h.calls).not.toContain('context');
  });
  it('denies roles changed between canonical context and mutation', async () => {
    const h = harness();
    let count = 0;
    h.deps.membership.fetch = async () => ({
      ...member,
      roleIds: ++count === 1 ? member.roleIds : [],
    });
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
  });
  it('denies a fresh REST error instead of fabricating eligibility', async () => {
    const h = harness();
    h.deps.membership.fetch = async () => {
      throw Error('private provider payload');
    };
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
    expect(JSON.stringify(h.replies)).not.toContain('private');
  });
  it('shows a fixed same-origin account link only when website reports unlinked', async () => {
    const h = harness();
    h.deps.website.context = async (request) => ({
      schemaVersion: 1,
      request,
      state: 'unlinked',
      matchId: null,
      revision: null,
      signup: null,
      participation: null,
    });
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
    expect(h.replies[0]!.content).toContain('https://valkyriawdg.cz/cs/account');
  });
  it('does not trust a context returned for another Discord message', async () => {
    const h = harness();
    const original = h.deps.website.context;
    h.deps.website.context = async (request) => ({
      ...(await original(request)),
      request: { ...request, messageId: input.userId },
    });
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
  });
  it.each(['locked', 'closed'] as const)('does not mutate a %s signup', async (signup) => {
    const h = harness();
    const original = h.deps.website.context;
    h.deps.website.context = async (request) => {
      const context = await original(request);
      if (context.state !== 'ready') throw Error('fixture');
      return { ...context, signup };
    };
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
  });
  it('reads my participation in English without a mutation', async () => {
    const h = harness({ customId: `vlk:signup:mine:${publicationId}:en` });
    await handleSignup(h.port, h.deps);
    expect(h.commands).toHaveLength(0);
    expect(h.replies[0]!.content).toContain('Not signed up');
  });
  it('reports a committed waitlist outcome, not a guaranteed roster slot', async () => {
    const h = harness();
    h.deps.website.participate = async (command) => ({
      schemaVersion: 1,
      command,
      status: 'committed',
      participation: 'waitlisted',
      revision: '5',
      committedAt: now.toISOString(),
    });
    await handleSignup(h.port, h.deps);
    expect(h.replies[0]!.content).toContain('čekací');
  });
  it('reports authoritative withdraw and stable actor/interaction idempotency', async () => {
    const h = harness({ customId: `vlk:signup:withdraw:${publicationId}:en` });
    await handleSignup(h.port, h.deps);
    await handleSignup(h.port, h.deps);
    expect(h.commands[0]!.idempotencyKey).toBe(h.commands[1]!.idempotencyKey);
    expect(h.replies[0]!.content).toContain('withdrawal');
  });
  it('does not retry or claim success after an unknown mutation result', async () => {
    const h = harness();
    let writes = 0;
    h.deps.website.participate = async () => {
      writes++;
      throw new WebsiteError('website_unknown');
    };
    await handleSignup(h.port, h.deps);
    expect(writes).toBe(1);
    expect(h.replies[0]!.content).toContain('ověřit');
  });
  it('does not report a schema-valid result for a different actor as success', async () => {
    const h = harness();
    const original = h.deps.website.participate;
    h.deps.website.participate = async (command) => ({
      ...(await original(command)),
      command: { ...command, userId: input.sourceMessageId },
    });
    await handleSignup(h.port, h.deps);
    expect(h.replies[0]!.content).toContain('ověřit');
  });
  it('does not resend when the final Discord reply fails after website commit', async () => {
    const h = harness();
    h.port.editReply = async () => {
      throw Error('discord unavailable');
    };
    await expect(handleSignup(h.port, h.deps)).rejects.toThrow('discord unavailable');
    expect(h.commands).toHaveLength(1);
  });
});
