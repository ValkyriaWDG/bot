import { describe, expect, it } from 'vitest';
import { PublicationIngress } from '../src/integration/publication-ingress.js';

function fixture() {
  let cursor = '0';
  const accepted: unknown[] = [];
  const requests: string[] = [];
  const store = {
    read: async () => cursor,
    advance: async (expected: string, next: string) => {
      if (cursor !== expected) return false;
      cursor = next;
      return true;
    },
  };
  return { store, accepted, requests, cursor: () => cursor };
}

describe('durable website publication ingress', () => {
  it('performs no website or database work when disabled', async () => {
    const deny = async (): Promise<never> => {
      throw new Error('unexpected_io');
    };
    const ingress = new PublicationIngress({
      enabled: false,
      source: { events: deny },
      store: { read: deny, advance: deny },
      consumer: { accept: deny },
    });
    await expect(ingress.tick()).resolves.toEqual({ accepted: 0, state: 'disabled' });
  });

  it('persists the cursor only after every event is durably accepted', async () => {
    const f = fixture();
    const first = { id: 'one' },
      second = { id: 'two' };
    let fail = true;
    const ingress = new PublicationIngress({
      enabled: true,
      store: f.store,
      source: {
        events: async (cursor) => {
          f.requests.push(cursor);
          return { events: [first, second], nextCursor: '2' };
        },
      },
      consumer: {
        accept: async (event) => {
          if (event === second && fail) throw new Error('db_down');
          f.accepted.push(event);
        },
      },
    });
    await expect(ingress.tick()).rejects.toThrow('db_down');
    expect(f.cursor()).toBe('0');
    fail = false;
    await expect(ingress.tick()).resolves.toEqual({ accepted: 2, state: 'accepted' });
    expect(f.requests).toEqual(['0', '0']);
    expect(f.cursor()).toBe('2');
    // The consumer owns idempotent event receipts; replay is expected after a crash.
    expect(f.accepted).toEqual([first, first, second]);
  });

  it('does not overlap polls and releases its busy guard after failure', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const ingress = new PublicationIngress({
      enabled: true,
      store: f.store,
      consumer: { accept: async () => {} },
      source: {
        events: async () => {
          await gate;
          throw new Error('unavailable');
        },
      },
    });
    const pending = ingress.tick();
    await expect(ingress.tick()).resolves.toEqual({ accepted: 0, state: 'busy' });
    release();
    await expect(pending).rejects.toThrow('unavailable');
    await expect(ingress.tick()).rejects.toThrow('unavailable');
  });

  it('rejects cursor rewind, non-progressing events, oversized pages and conflicts', async () => {
    for (const page of [
      { events: [], nextCursor: '-1' },
      { events: [{}], nextCursor: '0' },
      { events: Array(51).fill({}), nextCursor: '51' },
    ]) {
      const f = fixture();
      const ingress = new PublicationIngress({
        enabled: true,
        store: f.store,
        source: { events: async () => page },
        consumer: {
          accept: async (event) => {
            f.accepted.push(event);
          },
        },
      });
      await expect(ingress.tick()).rejects.toThrow('invalid_publication_page');
      expect(f.accepted).toEqual([]);
      expect(f.cursor()).toBe('0');
    }
    const ingress = new PublicationIngress({
      enabled: true,
      store: { read: async () => '0', advance: async () => false },
      source: { events: async () => ({ events: [], nextCursor: '1' }) },
      consumer: { accept: async () => {} },
    });
    await expect(ingress.tick()).rejects.toThrow('publication_cursor_conflict');
  });
});
