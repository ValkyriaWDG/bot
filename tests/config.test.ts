import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

export const example = {
  guildId: '111111111111111111',
  applicationId: '222222222222222222',
  defaultLocale: 'cs',
  websiteUrl: 'https://valkyriawdg.cz',
  servers: [
    {
      id: 'primary',
      label: 'Valkyria',
      baseUrl: 'https://rcon.example.invalid',
      tokenEnv: 'WARDOGS_PRIMARY_TOKEN',
      grants: { 'server.status': ['333333333333333333'] },
    },
  ],
  roleSync: {
    enabled: false,
    url: 'https://valkyriawdg.cz/api/integrations/discord/role-sync',
    keyId: 'primary',
    secretEnv: 'ROLE_SYNC_SIGNING_SECRET',
    reconcileSeconds: 60,
  },
};
describe('operator configuration boundary', () => {
  it('accepts explicit role grants and preserves snowflake strings', () => {
    const config = parseConfig(example);
    expect(config.guildId).toBe('111111111111111111');
    expect(config.servers[0]?.grants['server.control']).toBeUndefined();
  });
  it.each([
    { ...example, guildId: Number('111111111111111111') },
    { ...example, servers: [...example.servers, ...example.servers] },
    { ...example, websiteUrl: 'https://user:password@example.invalid' },
    { ...example, servers: [{ ...example.servers[0], baseUrl: 'http://remote.example.invalid' }] },
    {
      ...example,
      servers: [
        { ...example.servers[0], baseUrl: 'https://rcon.example.invalid/secret?key=secret' },
      ],
    },
    {
      ...example,
      servers: [{ ...example.servers[0], grants: { administrator: ['333333333333333333'] } }],
    },
    { ...example, roleSync: { ...example.roleSync, url: 'https://example.invalid/wrong' } },
    { ...example, unexpectedToken: 'must-not-be-accepted' },
  ])('rejects malformed or unsafe configuration without echoing input', (input) => {
    expect(() => parseConfig(input)).toThrow('invalid_configuration');
  });
});
