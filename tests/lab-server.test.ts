import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';

let child: ChildProcess | undefined;
afterEach(async () => {
  if (child?.exitCode === null) {
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
  child = undefined;
});
it('serves only the generated report and viewer assets on loopback with no write endpoints', async () => {
  await mkdir('.local/lab-server-test', { recursive: true });
  await writeFile(
    '.local/lab-server-test/report.json',
    JSON.stringify({
      schemaVersion: 1,
      evidenceKind: 'simulated-discord',
      scenarios: [],
      summary: { total: 0, passed: 0, failed: 0 },
    }),
  );
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  child = spawn(process.execPath, ['scripts/lab-server.mjs'], {
    env: {
      ...process.env,
      LAB_PORT: String(address.port),
      LAB_REPORT_FILE: '.local/lab-server-test/report.json',
    },
    stdio: 'pipe',
  });
  const url = `http://127.0.0.1:${address.port}`;
  await vi.waitFor(async () => expect((await fetch(url)).status).toBe(200), { timeout: 5000 });
  const report = await fetch(`${url}/report.json`);
  expect((await report.json()).evidenceKind).toBe('simulated-discord');
  expect(report.headers.get('cache-control')).toBe('no-store');
  expect(report.headers.get('content-security-policy')).toContain("default-src 'self'");
  expect((await fetch(`${url}/package.json`)).status).toBe(404);
  expect((await fetch(`${url}/report.json`, { method: 'POST', body: '{}' })).status).toBe(405);
});
it('fails visibly when no lab report exists instead of serving invented pass results', () => {
  const result = spawnSync(process.execPath, ['scripts/lab-server.mjs'], {
    env: { ...process.env, LAB_REPORT_FILE: '.local/does-not-exist-lab.json' },
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('lab_report_unavailable');
});
