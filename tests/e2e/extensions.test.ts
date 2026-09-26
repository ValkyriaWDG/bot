import { describe, expect, it } from 'vitest';
import { runExtensionsLab } from '../../scripts/extensions-lab.js';

describe('production publication and signup extension chain', () => {
  it('proves every required synthetic story through real HTTP and isolated PostgreSQL', async () => {
    if (!process.env.LAB_DATABASE_URL)
      throw Error('LAB_DATABASE_URL required for disposable database');
    const report = await runExtensionsLab(process.env.LAB_DATABASE_URL);
    const ids = [
      'fixture-cs',
      'fixture-en',
      'result-cs',
      'result-en',
      'status-stale-cs',
      'status-unknown-en',
      'signup-join-cs',
      'signup-waitlist-en',
      'signup-withdraw-cs',
      'signup-mine-en',
      'signup-unlinked-cs',
      'signup-revoked-en',
      'signup-unknown-en',
      'publication-withdrawn-cs',
    ];
    expect(report.scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining(ids));
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.summary.total);
    for (const scenario of report.scenarios) {
      expect(scenario.status, scenario.id).toBe('passed');
      expect(scenario.checks.length).toBeGreaterThan(0);
      expect(
        scenario.checks.every((check) => check.passed),
        scenario.id,
      ).toBe(true);
    }
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(process.env.LAB_DATABASE_URL);
    expect(serialized).not.toMatch(
      /x-valkyria-signature|test-signup-secret|test-publication-secret|Authorization/i,
    );
    expect(report.environment.database).toContain('schema removed');
  }, 60000);
});
