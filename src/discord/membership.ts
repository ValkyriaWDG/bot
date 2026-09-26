import type { Membership, MembershipProvider } from '../contracts.js';
import { z } from 'zod';
import { snowflake } from '../config.js';
import { BotError } from '../errors.js';
const memberSchema = z.object({
  user: z.object({ id: snowflake }),
  roles: z.array(snowflake).max(250),
});
export class DiscordMembershipProvider implements MembershipProvider {
  private generations = new Map<string, number>();
  constructor(
    private rest: { get: (route: `/${string}`) => Promise<unknown> },
    private guildId: string,
  ) {}
  invalidate(userId: string) {
    this.generations.set(userId, (this.generations.get(userId) ?? 0) + 1);
  }
  async fetch(guildId: string, userId: string): Promise<Membership> {
    if (guildId !== this.guildId) throw new BotError('wrong_guild');
    if (!snowflake.safeParse(userId).success) throw new BotError('membership_unavailable');
    const generation = this.generations.get(userId) ?? 0;
    try {
      const member = memberSchema.parse(
        await this.rest.get(`/guilds/${guildId}/members/${userId}`),
      );
      if (member.user.id !== userId || generation !== (this.generations.get(userId) ?? 0))
        throw new BotError('membership_unavailable');
      return {
        guildId,
        userId,
        roleIds: [...new Set(member.roles)],
        state: 'present',
        observedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 10007 &&
        generation === (this.generations.get(userId) ?? 0)
      )
        return {
          guildId,
          userId,
          roleIds: [],
          state: 'left',
          observedAt: new Date().toISOString(),
        };
      throw new BotError('membership_unavailable');
    }
  }
}
