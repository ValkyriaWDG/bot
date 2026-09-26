import type { ActionStore, Actor, Intent } from '../src/contracts.js';
export class MemoryActions implements ActionStore {
  intents = new Map<string, Intent>();
  events: { action: string; code: string }[] = [];
  async createIntent(intent: Intent) {
    if ([...this.intents.values()].some((row) => row.interactionId === intent.interactionId))
      return false;
    this.intents.set(intent.id, structuredClone(intent));
    return true;
  }
  async getIntent(id: string) {
    return structuredClone(this.intents.get(id) ?? null);
  }
  async claimIntent(id: string, actor: Actor, now: Date) {
    const intent = this.intents.get(id);
    if (
      !intent ||
      intent.userId !== actor.userId ||
      intent.guildId !== actor.guildId ||
      intent.state !== 'pending' ||
      new Date(intent.expiresAt) <= now
    )
      return false;
    if (
      [...this.intents.values()].some(
        (i) => i.serverId === intent.serverId && i.state === 'executing',
      )
    )
      return false;
    intent.state = 'executing';
    this.events.push({ action: intent.action.type, code: 'dispatching' });
    return true;
  }
  async finishIntent(id: string, state: 'succeeded' | 'failed' | 'unknown', code: string) {
    const intent = this.intents.get(id);
    if (!intent) throw new Error('missing intent');
    intent.state = state;
    this.events.push({ action: intent.action.type, code });
  }
  async cancelIntent(id: string, actor: Actor) {
    const intent = this.intents.get(id);
    if (
      !intent ||
      intent.userId !== actor.userId ||
      intent.guildId !== actor.guildId ||
      intent.state !== 'pending'
    )
      return false;
    intent.state = 'cancelled';
    return true;
  }
  async audit(_actor: Actor, action: string, _serverId: string | null, code: string) {
    this.events.push({ action, code });
  }
}
