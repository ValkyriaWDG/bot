import { describe, expect, it } from 'vitest';
import { DiscordMembershipProvider } from '../src/discord/membership.js';
const guild = '111111111111111111',
  user = '222222222222222222',
  role = '333333333333333333';
describe('fresh Discord membership', () => {
  it('uses fresh REST member fields and never converts snowflakes to numbers', async () => {
    const routes: string[] = [];
    const provider = new DiscordMembershipProvider(
      {
        get: async (route) => {
          routes.push(route);
          return { user: { id: user }, roles: [role] };
        },
      },
      guild,
    );
    const result = await provider.fetch(guild, user);
    expect(result).toMatchObject({
      guildId: guild,
      userId: user,
      roleIds: [role],
      state: 'present',
    });
    expect(routes).toEqual([`/guilds/${guild}/members/${user}`]);
  });
  it('only explicit unknown-member means departed, while access failure is unknown', async () => {
    const missing = new DiscordMembershipProvider(
      {
        get: async () => {
          throw { code: 10007 };
        },
      },
      guild,
    );
    expect(await missing.fetch(guild, user)).toMatchObject({ state: 'left', roleIds: [] });
    for (const code of [50001, 10004, 50013]) {
      const unavailable = new DiscordMembershipProvider(
        {
          get: async () => {
            throw { code };
          },
        },
        guild,
      );
      await expect(unavailable.fetch(guild, user)).rejects.toThrow('membership_unavailable');
    }
  });
  it('rejects a REST response started before a member invalidation', async () => {
    let finish: (value: unknown) => void = () => {};
    const provider = new DiscordMembershipProvider(
      {
        get: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
      guild,
    );
    const pending = provider.fetch(guild, user);
    provider.invalidate(user);
    finish({ user: { id: user }, roles: [role] });
    await expect(pending).rejects.toThrow('membership_unavailable');
  });
  it('rejects wrong guild and mismatched identity without exposing raw errors', async () => {
    const provider = new DiscordMembershipProvider(
      { get: async () => ({ user: { id: guild }, roles: [role] }) },
      guild,
    );
    await expect(provider.fetch(user, user)).rejects.toThrow('wrong_guild');
    await expect(provider.fetch(guild, user)).rejects.toThrow('membership_unavailable');
  });
});
