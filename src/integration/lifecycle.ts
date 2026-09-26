import type { BotConfig } from '../contracts.js';
import type { ManagementSettingsSnapshot } from '../management/types.js';
import { revisionSchema, validateManagementSettings } from '../management/settings.js';

/** One in-flight operation per job; stop fences future starts and drains existing work. */
export class PeriodicTasks {
  private stopped = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private pending = new Set<Promise<void>>();
  constructor(private readonly onError: () => void) {}
  start(work: () => Promise<unknown>, intervalMs: number) {
    if (this.stopped) return;
    let busy = false;
    const run = () => {
      if (this.stopped || busy) return;
      busy = true;
      const promise = Promise.resolve()
        .then(() => (this.stopped ? undefined : work()))
        .then(() => {}, this.onError)
        .finally(() => {
          busy = false;
          this.pending.delete(promise);
        });
      this.pending.add(promise);
    };
    this.timers.push(setInterval(run, intervalMs));
    run();
  }
  async stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await Promise.allSettled([...this.pending]);
  }
}

export class EffectiveSettings {
  private snapshot: ManagementSettingsSnapshot | null = null;
  constructor(private readonly config: BotConfig) {}
  apply(snapshot: ManagementSettingsSnapshot) {
    revisionSchema.parse(snapshot.revision);
    if (this.snapshot && BigInt(snapshot.revision) <= BigInt(this.snapshot.revision)) return;
    const settings = validateManagementSettings(snapshot.settings, this.config);
    // Validation completes before any synchronous mutation; readers cannot see half an update.
    this.config.defaultLocale = settings.defaultLocale;
    for (const server of this.config.servers) server.label = settings.serverLabels[server.id]!;
    this.snapshot = structuredClone({ revision: snapshot.revision, settings });
  }
  get() {
    return structuredClone(this.snapshot);
  }
}
