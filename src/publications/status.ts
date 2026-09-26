import { z } from 'zod';
import type { ServerStatus } from '../contracts.js';
import {
  destinationSchema,
  type PublicationStore,
  type StatusBoardConfig,
  type StatusProjection,
} from './contracts.js';

const sampleSchema = z
  .object({
    serverName: z.string().trim().min(1).max(300),
    map: z.string().trim().min(1).max(256),
    playerCount: z.number().int().min(0).max(10000),
    maxPlayers: z.number().int().min(1).max(10000),
    matchSeconds: z.number().int().min(0).max(31_536_000).nullable(),
  })
  .strict()
  .refine((s) => s.playerCount <= s.maxPlayers);
export interface StatusBoardPollerOptions {
  store: Pick<PublicationStore, 'status' | 'observeStatus'>;
  boards: StatusBoardConfig[];
  readStatus: (serverId: string) => Promise<ServerStatus>;
  enabled: boolean;
  now?: () => Date;
}
export class StatusBoardPoller {
  private running = false;
  private cursor = 0;
  private readonly due = new Map<number, number>();
  private readonly now: () => Date;
  constructor(private readonly options: StatusBoardPollerOptions) {
    this.now = options.now ?? (() => new Date());
    if (options.boards.length > 25) throw new Error('publication_invalid_boards');
    for (const b of options.boards) {
      destinationSchema.parse(b.destination);
      if (
        b.destination.purpose !== 'status' ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(b.serverId) ||
        !b.label.trim() ||
        b.label.length > 160 ||
        !Number.isInteger(b.pollSeconds) ||
        b.pollSeconds < 30 ||
        b.pollSeconds > 300 ||
        !Number.isInteger(b.freshForSeconds) ||
        b.freshForSeconds < 60 ||
        b.freshForSeconds > 600 ||
        b.freshForSeconds < b.pollSeconds * 2
      )
        throw new Error('publication_invalid_boards');
    }
    if (
      new Set(
        options.boards.map(
          (b) => `${b.serverId}:${b.destination.channelId}:${b.destination.locale}`,
        ),
      ).size !== options.boards.length
    )
      throw new Error('publication_duplicate_board');
    const policies = new Map<string, string>();
    for (const b of options.boards) {
      const key = `${b.serverId}:${b.destination.locale}`;
      const policy = JSON.stringify([b.label, b.pollSeconds, b.freshForSeconds]);
      if (policies.has(key) && policies.get(key) !== policy)
        throw new Error('publication_conflicting_board_policy');
      policies.set(key, policy);
    }
  }
  async tick(): Promise<void> {
    if (!this.options.enabled || this.running || !this.options.boards.length) return;
    this.running = true;
    try {
      for (let attempt = 0; attempt < this.options.boards.length; attempt++) {
        const index = this.cursor++ % this.options.boards.length;
        const b = this.options.boards[index]!;
        if (this.now().getTime() < (this.due.get(index) ?? 0)) continue;
        this.due.set(index, this.now().getTime() + b.pollSeconds * 1000);
        const previous = await this.options.store.status(b.serverId, b.destination.locale);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let projection: StatusProjection;
        try {
          const result = await Promise.race([
            this.options.readStatus(b.serverId),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('status_timeout')), 5000);
            }),
          ]);
          const sample = sampleSchema.parse(result);
          const now = this.now();
          projection = {
            kind: 'status',
            serverId: b.serverId,
            label: b.label,
            locale: b.destination.locale,
            state: 'current',
            observedAt: now.toISOString(),
            validUntil: new Date(now.getTime() + b.freshForSeconds * 1000).toISOString(),
            sample,
          };
        } catch {
          projection = previous?.sample
            ? { ...previous, label: b.label, state: 'stale' }
            : {
                kind: 'status',
                serverId: b.serverId,
                label: b.label,
                locale: b.destination.locale,
                state: 'unknown',
                observedAt: null,
                validUntil: null,
                sample: null,
              };
        } finally {
          if (timer) clearTimeout(timer);
        }
        await this.options.store.observeStatus(
          b.destination,
          projection,
          b.freshForSeconds * 500,
          this.now(),
        );
        break;
      }
    } finally {
      this.running = false;
    }
  }
}
