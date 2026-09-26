import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseManagementConfig,
  signManagementRequest,
  verifyManagementRequest,
} from '../src/management/index.js';

const actor = { guildId: '111111111111111111', userId: '222222222222222222' };
const secret = 'synthetic-management-only-key-0000000000000000';
const now = new Date('2026-09-26T12:00:00.000Z');
const config = {
  keys: { website: { secret, scopes: ['bot.read', 'bot.configure'] } },
  grants: { 'bot.read': ['333333333333333333'], 'bot.configure': ['444444444444444444'] },
};
const path = '/api/management/v1/settings';
const body =
  '{"expectedRevision":"0","settings":{"defaultLocale":"en","serverLabels":{"primary":"Valkyria"}},"reason":"Update language","correlationId":"11111111-1111-4111-8111-111111111111"}';
function signed() {
  return signManagementRequest({
    method: 'PATCH',
    path,
    body,
    actor,
    keyId: 'website',
    secret,
    now,
    nonce: 'a'.repeat(32),
  });
}
function verify(overrides = {}) {
  return verifyManagementRequest({
    method: 'PATCH',
    path,
    ...signed(),
    config: parseManagementConfig(config),
    guildId: actor.guildId,
    now,
    ...overrides,
  });
}

describe('purpose-specific management signatures', () => {
  it('binds method, path, key, exact body, timestamp, nonce and actor using an independent HMAC vector', () => {
    const result = signed();
    const expected = createHmac('sha256', secret)
      .update(
        `VALKYRIA-MANAGEMENT-V1\nPATCH\n${path}\nwebsite\n1790424000\n${'a'.repeat(32)}\n${actor.guildId}\n${actor.userId}\n${body}`,
      )
      .digest('hex');
    expect(result.headers['X-Valkyria-Management-Signature']).toBe(expected);
    expect(verify()).toMatchObject({
      actor,
      keyId: 'website',
      scope: 'bot.configure',
      nonce: 'a'.repeat(32),
    });
  });
  it('rejects unsigned, altered-body, actor-forged, cross-guild and wrong-method requests', () => {
    const original = signed();
    for (const overrides of [
      { headers: {} },
      { body: `${body} ` },
      { method: 'GET' },
      { path: `${path}?scope=bot.configure` },
      { guildId: '999999999999999999' },
      { headers: { ...original.headers, 'X-Valkyria-Management-Actor': '999999999999999999' } },
    ])
      expect(() => verify(overrides)).toThrow(/MANAGEMENT_/);
  });
  it('rejects stale/future envelopes, wrong service scope and unknown rotated keys', () => {
    expect(() => verify({ now: new Date(now.getTime() + 61_000) })).toThrow(/EXPIRED/);
    expect(() => verify({ now: new Date(now.getTime() - 6000) })).toThrow(/EXPIRED/);
    const readOnly = parseManagementConfig({
      ...config,
      keys: { website: { secret, scopes: ['bot.read'] } },
    });
    expect(() => verify({ config: readOnly })).toThrow(/SCOPE/);
    expect(() =>
      verify({
        config: parseManagementConfig({
          ...config,
          keys: { next: { secret, scopes: ['bot.configure'] } },
        }),
      }),
    ).toThrow(/SIGNATURE/);
  });
  it('supports explicit current/previous keys without treating a role-sync signature as management authority', () => {
    const rotated = parseManagementConfig({
      ...config,
      keys: { ...config.keys, next: { secret: secret + 'next', scopes: ['bot.read'] } },
    });
    expect(verify({ config: rotated }).keyId).toBe('website');
    const result = signed();
    result.headers['X-Valkyria-Management-Signature'] = createHmac('sha256', secret)
      .update(
        `POST\n/api/integrations/discord/role-sync\nwebsite\n1790424000\n${'a'.repeat(32)}\n${body}`,
      )
      .digest('hex');
    expect(() => verify({ headers: result.headers })).toThrow(/SIGNATURE/);
  });
  it('rejects unbounded bodies and unsupported config fields without leaking secrets', () => {
    expect(() => verify({ body: 'x'.repeat(16_385) })).toThrow(/MANAGEMENT_/);
    for (const invalid of [
      null,
      { ...config, shell: true },
      { ...config, keys: { website: { secret: 'short', scopes: ['bot.configure'] } } },
      { ...config, grants: { ...config.grants, owner: [actor.userId] } },
    ]) {
      expect(() => parseManagementConfig(invalid)).toThrow('MANAGEMENT_INVALID_CONFIG');
    }
  });
});
