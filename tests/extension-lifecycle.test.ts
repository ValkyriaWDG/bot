import { afterEach, expect, it, vi } from 'vitest';
import { PeriodicTasks, EffectiveSettings } from '../src/integration/lifecycle.js';
import { listenUntilAborted } from '../src/integration/listener.js';
import { createServer } from 'node:http';
import { parseConfig } from '../src/config.js';
import example from '../config/bot.example.json' with { type: 'json' };

afterEach(() => vi.useRealTimers());

it('does not execute a queued periodic task after immediate shutdown', async () => {
  const work = vi.fn(async () => {});
  const tasks = new PeriodicTasks(() => {});
  tasks.start(work, 1000);
  await tasks.stop();
  expect(work).not.toHaveBeenCalled();
});

it('settles listener startup when shutdown arrives before the bind callback', async () => {
  const server = createServer();
  const abort = new AbortController();
  const started = listenUntilAborted(server, { host: '127.0.0.1', port: 0 }, abort.signal);
  abort.abort();
  expect(await started).toBe(false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(server.listening).toBe(false);
});

it('runs bounded periodic tasks without overlap and drains them before stopping', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const work = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const failure = vi.fn();
  const tasks = new PeriodicTasks(failure);
  tasks.start(work, 1000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(work).toHaveBeenCalledTimes(1);
  let stopped = false;
  const close = tasks.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish();
  await close;
  await vi.advanceTimersByTimeAsync(5000);
  expect(work).toHaveBeenCalledTimes(1);
  expect(failure).not.toHaveBeenCalled();
});

it('contains failed work and cannot schedule work after shutdown', async () => {
  vi.useFakeTimers();
  const failed = vi.fn();
  const tasks = new PeriodicTasks(failed);
  const work = vi.fn(async () => {
    throw new Error('private error');
  });
  tasks.start(work, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(work).toHaveBeenCalledTimes(2);
  await tasks.stop();
  tasks.start(work, 1000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(work).toHaveBeenCalledTimes(2);
});

it('applies actual settings atomically and never rolls back the effective revision', () => {
  const bot = parseConfig(example);
  const effective = new EffectiveSettings(bot);
  const serverId = bot.servers[0]!.id;
  effective.apply({
    revision: '0',
    settings: { defaultLocale: 'cs', serverLabels: { [serverId]: 'Initial name' } },
  });
  expect(effective.get()?.revision).toBe('0');
  effective.apply({
    revision: '2',
    settings: { defaultLocale: 'en', serverLabels: { [serverId]: 'Public name' } },
  });
  effective.apply({
    revision: '1',
    settings: { defaultLocale: 'cs', serverLabels: { [serverId]: 'Stale name' } },
  });
  expect(bot.defaultLocale).toBe('en');
  expect(bot.servers[0]!.label).toBe('Public name');
  expect(effective.get()?.revision).toBe('2');
  expect(() =>
    effective.apply({ revision: '3', settings: { defaultLocale: 'cs', serverLabels: {} } }),
  ).toThrow();
  expect(bot.defaultLocale).toBe('en');
  expect(effective.get()?.revision).toBe('2');
  const detached = effective.get()!;
  detached.settings.defaultLocale = 'cs';
  expect(effective.get()?.settings.defaultLocale).toBe('en');
});
