import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHealthServer } from '../src/health.js';
const servers: ReturnType<typeof createHealthServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});
async function start(ready: () => Promise<boolean>, mode: 'live' | 'offline' = 'live') {
  const server = createHealthServer(ready, mode);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
describe('health boundaries', () => {
  it('separates liveness from unavailable dependencies without leaking errors', async () => {
    const base = await start(async () => {
      throw new Error('database-password-secret');
    });
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    const ready = await fetch(`${base}/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.text()).not.toContain('secret');
    expect((await fetch(`${base}/anything`)).status).toBe(404);
  });
  it('never marks offline fixture mode ready for live work', async () => {
    const base = await start(async () => true, 'offline');
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    expect(await (await fetch(`${base}/health/live`)).json()).toEqual({
      status: 'alive',
      mode: 'offline',
    });
  });
});
