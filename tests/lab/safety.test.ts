import { afterEach, expect, it, vi } from 'vitest';
import { validateLabDatabase } from './run.js';
afterEach(() => vi.unstubAllEnvs());
it('accepts dedicated loopback test databases and refuses production/URL option overrides', () => {
  vi.stubEnv('CI', '');
  vi.stubEnv('LAB_ALLOW_NON_LOOPBACK', '');
  expect(() =>
    validateLabDatabase('postgresql://fixture@127.0.0.1:55439/valkyria_bot_test'),
  ).not.toThrow();
  for (const value of [
    'postgresql://fixture@db.example/valkyria_bot_test',
    'postgresql://fixture@127.0.0.1/production',
    'postgresql://fixture@127.0.0.1/valkyria_bot_test?options=override',
    'https://127.0.0.1/valkyria_bot_test',
  ])
    expect(() => validateLabDatabase(value)).toThrow('LAB_DATABASE_TARGET_REFUSED');
});
it('requires both explicit CI opt-in and a named lab database for non-loopback fixtures', () => {
  vi.stubEnv('CI', 'true');
  vi.stubEnv('LAB_ALLOW_NON_LOOPBACK', '');
  expect(() => validateLabDatabase('postgresql://fixture@postgres/valkyria_bot_test')).toThrow(
    'LAB_DATABASE_TARGET_REFUSED',
  );
  vi.stubEnv('LAB_ALLOW_NON_LOOPBACK', 'true');
  expect(() =>
    validateLabDatabase('postgresql://fixture@postgres/valkyria_bot_test'),
  ).not.toThrow();
  expect(() => validateLabDatabase('postgresql://fixture@postgres/production')).toThrow(
    'LAB_DATABASE_TARGET_REFUSED',
  );
});
