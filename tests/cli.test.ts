import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';

const run = promisify(execFile);
const env = {
  ...process.env,
  BOT_CONFIG_FILE: 'config/bot.example.json',
  DISCORD_BOT_TOKEN: '',
  DATABASE_URL: '',
};
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
  child = undefined;
});
it('prints a guild command manifest without credentials and rejects a mismatched apply target', async () => {
  const args = ['--import', 'tsx', 'src/cli/register.ts'];
  const result = await run(process.execPath, args, { env });
  const manifest = JSON.parse(result.stdout);
  expect(manifest.mode).toBe('dry-run');
  expect(manifest.commands.map((command: { name: string }) => command.name)).toEqual([
    'help',
    'account',
    'server',
    'admin',
  ]);
  try {
    await run(
      process.execPath,
      [
        ...args,
        '--apply',
        '--guild',
        '999999999999999999',
        '--application',
        manifest.applicationId,
      ],
      { env },
    );
    throw new Error('expected rejection');
  } catch (error) {
    expect((error as { stderr: string }).stderr).toContain('registration_target_mismatch');
    expect((error as { stderr: string }).stderr).not.toContain('missing_secret');
  }
});
it('offline runtime needs neither configuration nor secrets and never claims readiness', async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', '--offline'], {
    env: {
      ...env,
      BOT_CONFIG_FILE: 'does-not-exist.json',
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: String(port),
    },
    stdio: 'pipe',
  });
  const url = `http://127.0.0.1:${port}`;
  await vi.waitFor(async () => expect((await fetch(`${url}/health/live`)).status).toBe(200), {
    timeout: 5000,
    interval: 100,
  });
  const ready = await fetch(`${url}/health/ready`);
  expect(ready.status).toBe(503);
  expect(await ready.json()).toEqual({ status: 'unavailable', mode: 'offline' });
});
