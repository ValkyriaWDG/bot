import { describe, expect, it, vi } from 'vitest';
import { StatusBoardPoller } from '../src/publications/status.js';
import type {
  PublicationStore,
  StatusBoardConfig,
  StatusProjection,
} from '../src/publications/contracts.js';

const board: StatusBoardConfig = {
  destination: {
    guildId: '111111111111111111',
    channelId: '222222222222222222',
    locale: 'cs',
    purpose: 'status',
  },
  serverId: 'primary',
  label: 'Primary',
  pollSeconds: 30,
  freshForSeconds: 90,
};
describe('bounded status observation', () => {
  it('is disabled by default at the runtime gate and performs no read', async () => {
    const readStatus = vi.fn();
    const store = { status: vi.fn(), observeStatus: vi.fn() };
    await new StatusBoardPoller({ store, readStatus, boards: [board], enabled: false }).tick();
    expect(readStatus).not.toHaveBeenCalled();
    expect(store.status).not.toHaveBeenCalled();
  });
  it('keeps a previous sample as STALE on failure and never invents offline/zero', async () => {
    const saved: StatusProjection = {
      kind: 'status',
      serverId: 'primary',
      label: 'Primary',
      locale: 'cs',
      state: 'current',
      observedAt: '2026-09-26T12:00:00Z',
      validUntil: '2026-09-26T12:01:30Z',
      sample: {
        serverName: 'Primary',
        map: 'EXAMPLE',
        playerCount: 5,
        maxPlayers: 100,
        matchSeconds: null,
      },
    };
    const store = {
      status: async () => saved,
      observeStatus: vi.fn<PublicationStore['observeStatus']>(async () => true),
    };
    const poller = new StatusBoardPoller({
      store,
      readStatus: async () => {
        throw new Error('403');
      },
      boards: [board],
      enabled: true,
      now: () => new Date('2026-09-26T12:02:00Z'),
    });
    await poller.tick();
    expect(store.observeStatus.mock.calls[0]?.[1]).toEqual({ ...saved, state: 'stale' });
  });
  it('bounds polling, coalesces overlapping ticks and stamps only successful validated observations', async () => {
    let clock = new Date('2026-09-26T12:00:00Z');
    const readStatus = vi.fn(async () => ({
      serverName: 'Primary',
      map: 'EXAMPLE',
      playerCount: 5,
      maxPlayers: 100,
      matchSeconds: null,
    }));
    const store = {
      status: async () => null,
      observeStatus: vi.fn<PublicationStore['observeStatus']>(async () => true),
    };
    const poller = new StatusBoardPoller({
      store,
      readStatus,
      boards: [board],
      enabled: true,
      now: () => clock,
    });
    await Promise.all([poller.tick(), poller.tick()]);
    await poller.tick();
    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(store.observeStatus.mock.calls[0]?.[1]).toMatchObject({
      state: 'current',
      observedAt: clock.toISOString(),
      validUntil: '2026-09-26T12:01:30.000Z',
    });
    clock = new Date(clock.getTime() + 30_000);
    await poller.tick();
    expect(readStatus).toHaveBeenCalledTimes(2);
  });
  it('rejects poll/freshness settings that make every observation immediately stale', () => {
    expect(
      () =>
        new StatusBoardPoller({
          store: { status: async () => null, observeStatus: async () => true },
          readStatus: vi.fn(),
          boards: [{ ...board, freshForSeconds: 30 }],
          enabled: true,
        }),
    ).toThrow();
  });
});
