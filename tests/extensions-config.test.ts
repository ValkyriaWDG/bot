import { expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import example from '../config/bot.example.json' with { type: 'json' };
import { parseExtensionsConfig, resolveExtensionSecrets } from '../src/extensions-config.js';

const bot = parseConfig(example);
const raw = () => ({
  management: {
    enabled: true,
    keys: { web: { secretEnv: 'CONTROL_SECRET', scopes: ['bot.read', 'bot.configure'] } },
    grants: { 'bot.read': ['333333333333333333'], 'bot.configure': ['444444444444444444'] },
  },
  website: {
    publications: { keyId: 'publication', secretEnv: 'PUBLICATION_SECRET' },
    signup: { keyId: 'signup', secretEnv: 'SIGNUP_SECRET' },
  },
  publications: {
    enabled: true,
    destinations: [
      { guildId: bot.guildId, channelId: '777777777777777777', locale: 'cs', purpose: 'fixture' },
    ],
  },
  signup: { enabled: true },
});
it('has no enabled extension or secret requirement without explicit configuration', () => {
  const result = parseExtensionsConfig({}, bot);
  expect(result.management.enabled).toBe(false);
  expect(result.publications.enabled).toBe(false);
  expect(result.signup.enabled).toBe(false);
  expect(resolveExtensionSecrets(result, bot, {})).toEqual({ management: {}, website: null });
});
it('accepts bounded explicit config and keeps bootstrap secrets out of editable settings', () => {
  const result = parseExtensionsConfig(raw(), bot);
  expect(result.management.host).toBe('127.0.0.1');
  expect(result.management.port).toBe(3001);
  expect(result.publications.pollSeconds).toBe(15);
  const secrets = resolveExtensionSecrets(result, bot, {
    CONTROL_SECRET: 'c'.repeat(32),
    PUBLICATION_SECRET: 'p'.repeat(32),
    SIGNUP_SECRET: 's'.repeat(32),
  });
  expect(Object.keys(secrets.management)).toEqual(['web']);
  expect(secrets.website?.signup.keyId).toBe('signup');
});
it('rejects unknown activation fields, wrong guild, duplicate destinations and invalid intervals', () => {
  expect(() => parseExtensionsConfig({ shell: 'execute' }, bot)).toThrow(
    'invalid_extensions_configuration',
  );
  expect(() => parseExtensionsConfig({ publications: { enabled: true } }, bot)).toThrow(
    'invalid_extensions_configuration',
  );
  const cfg = raw();
  cfg.publications.destinations[0]!.guildId = '999999999999999999';
  expect(() => parseExtensionsConfig(cfg, bot)).toThrow('invalid_extensions_configuration');
  const duplicate = raw();
  duplicate.publications.destinations.push(duplicate.publications.destinations[0]!);
  expect(() => parseExtensionsConfig(duplicate, bot)).toThrow('invalid_extensions_configuration');
  expect(() =>
    parseExtensionsConfig({ ...raw(), publications: { enabled: false, pollSeconds: 1 } }, bot),
  ).toThrow('invalid_extensions_configuration');
});
it('rejects reused, missing or weak purpose credentials without leaking their values', () => {
  const cfg = parseExtensionsConfig(raw(), bot);
  for (const env of [
    {},
    { CONTROL_SECRET: 'secret' },
    {
      CONTROL_SECRET: 'x'.repeat(32),
      PUBLICATION_SECRET: 'x'.repeat(32),
      SIGNUP_SECRET: 's'.repeat(32),
    },
  ]) {
    expect(() => resolveExtensionSecrets(cfg, bot, env)).toThrow('invalid_extensions_credentials');
  }
  expect(() =>
    resolveExtensionSecrets(cfg, bot, {
      CONTROL_SECRET: 'c'.repeat(32),
      PUBLICATION_SECRET: 'p'.repeat(32),
      SIGNUP_SECRET: 's'.repeat(32),
      ROLE_SYNC_SIGNING_SECRET: 'p'.repeat(32),
    }),
  ).toThrow('invalid_extensions_credentials');
});

it('allows separate server boards in one channel while rejecting a duplicate server board', () => {
  const twoServers = structuredClone(bot);
  twoServers.servers.push({ ...twoServers.servers[0]!, id: 'secondary' });
  const destination = {
    guildId: bot.guildId,
    channelId: '777777777777777777',
    locale: 'cs',
    purpose: 'status',
  };
  const board = {
    destination,
    serverId: bot.servers[0]!.id,
    label: 'Primary',
    pollSeconds: 60,
    freshForSeconds: 180,
  };
  const boards = [board, { ...board, serverId: 'secondary' }];
  expect(
    parseExtensionsConfig({ publications: { boards } }, twoServers).publications.boards,
  ).toHaveLength(2);
  expect(() =>
    parseExtensionsConfig({ publications: { boards: [board, board] } }, twoServers),
  ).toThrow();
});
