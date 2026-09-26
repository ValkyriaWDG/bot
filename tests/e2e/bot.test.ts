import { expect, it, vi } from 'vitest';
import { runLab } from '../lab/run.js';
import * as fixtures from '../lab/fixtures.js';

it('proves the simulated Discord journeys through real PostgreSQL and HTTP adapters', async () => {
  const databaseUrl = process.env.LAB_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      'LAB_DATABASE_URL must name a disposable lab database; this E2E check is not skipped.',
    );
  const report = await runLab(databaseUrl);
  const required = [
    'help-cs',
    'help-en',
    'status',
    'players',
    'broadcast-confirm',
    'kick-confirm',
    'ban-confirm',
    'unban-confirm',
    'map-confirm',
    'restart-confirm',
    'cancel-expiry',
    'authorization-denied',
    'role-revoked',
    'double-confirm',
    'unknown-outcome',
    'read-error',
    'audit-failure',
    'role-sync',
    'restart-recovery',
    'defer-failure',
    'reply-cleanup-failure',
  ];
  expect(report.evidenceKind).toBe('simulated-discord');
  expect(report.scenarios.map((scenario) => scenario.id).sort()).toEqual(required.sort());
  expect(report.summary.total).toBe(report.scenarios.length);
  expect(
    report.scenarios
      .filter((scenario) => scenario.status === 'failed')
      .map((scenario) => ({
        id: scenario.id,
        failedChecks: scenario.checks.filter((check) => !check.passed),
      })),
  ).toEqual([]);
  expect(report.summary.passed).toBe(report.scenarios.length);
  expect(report.summary.failed).toBe(0);
  expect(
    report.scenarios.every(
      (scenario) => scenario.checks.length > 0 && scenario.checks.every((check) => check.passed),
    ),
  ).toBe(true);
  expect(report.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
  expect(typeof report.sourceDirty).toBe('boolean');
  expect(JSON.stringify(report)).not.toMatch(
    /fixture-interaction-|fixture-discord-token|fixture-rcon-token|fixture-signing-secret|postgres(?:ql)?:\/\//,
  );
}, 120_000);

it('marks a normal journey failed when Discord rejects its final reply', async () => {
  const databaseUrl = process.env.LAB_DATABASE_URL;
  if (!databaseUrl) throw new Error('LAB_DATABASE_URL is required; E2E is not skipped.');
  const original = fixtures.createFixtures;
  vi.spyOn(fixtures, 'createFixtures').mockImplementationOnce(async () => {
    const lab = await original();
    lab.setRejectReply(true);
    return lab;
  });
  try {
    const report = await runLab(databaseUrl);
    expect(report.scenarios.find((scenario) => scenario.id === 'help-cs')?.status).toBe('failed');
    expect(report.summary.failed).toBeGreaterThan(0);
  } finally {
    vi.restoreAllMocks();
  }
}, 120_000);
