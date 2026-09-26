import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  ActionStore,
  BotConfig,
  Capability,
  GameServer,
  Intent,
  MembershipProvider,
  ServerAction,
} from './contracts.js';
import { BotError } from './errors.js';

const steamId = z.string().regex(/^[0-9]{17}$/);
const reason = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => [...s].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('broadcast'), message: reason }).strict(),
  z.object({ type: z.literal('kick'), steamId, reason }).strict(),
  z.object({ type: z.literal('ban'), steamId, reason }).strict(),
  z.object({ type: z.literal('unban'), steamId }).strict(),
  z.object({ type: z.literal('map'), map: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }).strict(),
  z.object({ type: z.literal('restart') }).strict(),
]);
const capabilityFor = (action: ServerAction): Capability =>
  action.type === 'broadcast'
    ? 'server.broadcast'
    : ['kick', 'ban', 'unban'].includes(action.type)
      ? 'server.moderate'
      : 'server.control';

export class OperationsService {
  constructor(
    private config: BotConfig,
    private members: MembershipProvider,
    private store: ActionStore,
    private games: Map<string, GameServer>,
    private writesEnabled: boolean,
    private now: () => Date = () => new Date(),
  ) {}

  private checkGuild(actor: Actor) {
    if (actor.guildId !== this.config.guildId) throw new BotError('wrong_guild');
  }
  private async membership(actor: Actor) {
    this.checkGuild(actor);
    let member;
    try {
      member = await this.members.fetch(actor.guildId, actor.userId);
    } catch {
      throw new BotError('membership_unavailable');
    }
    const age = this.now().getTime() - Date.parse(member.observedAt);
    if (
      member.guildId !== actor.guildId ||
      member.userId !== actor.userId ||
      !Number.isFinite(age) ||
      age < -5000 ||
      age > 60_000
    )
      throw new BotError('membership_unavailable');
    if (member.state !== 'present') throw new BotError('forbidden');
    return member;
  }
  private server(id: string) {
    const config = this.config.servers.find((s) => s.id === id);
    const game = this.games.get(id);
    if (!config || !game) throw new BotError('unknown_server');
    return { config, game };
  }
  private async authorize(actor: Actor, id: string, capability: Capability) {
    const server = this.server(id);
    const member = await this.membership(actor);
    if (!(server.config.grants[capability] ?? []).some((role) => member.roleIds.includes(role))) {
      await this.persist(() => this.store.audit(actor, capability, id, 'forbidden'));
      throw new BotError('forbidden');
    }
    return server.game;
  }
  private async persist<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new BotError('storage_unavailable');
    }
  }
  async account(actor: Actor) {
    const member = await this.membership(actor);
    const capabilities: Record<string, Capability[]> = {};
    for (const server of this.config.servers)
      capabilities[server.id] = (Object.entries(server.grants) as [Capability, string[]][])
        .filter(([, roles]) => roles.some((role) => member.roleIds.includes(role)))
        .map(([capability]) => capability);
    return { member, capabilities };
  }
  async status(actor: Actor, serverId: string) {
    return (await this.authorize(actor, serverId, 'server.status')).status();
  }
  async players(actor: Actor, serverId: string) {
    return (await this.authorize(actor, serverId, 'server.players')).players();
  }
  async preview(
    actor: Actor,
    interactionId: string,
    serverId: string,
    rawAction: ServerAction,
  ): Promise<Intent> {
    this.checkGuild(actor);
    if (!this.writesEnabled) throw new BotError('writes_disabled');
    const parsed = actionSchema.safeParse(rawAction);
    if (!parsed.success || !interactionId || interactionId.length > 100)
      throw new BotError('invalid_action');
    const action = parsed.data;
    await this.authorize(actor, serverId, capabilityFor(action));
    const intent: Intent = {
      ...actor,
      id: randomUUID(),
      interactionId,
      serverId,
      action,
      expiresAt: new Date(this.now().getTime() + 60_000).toISOString(),
      state: 'pending',
    };
    if (!(await this.persist(() => this.store.createIntent(intent))))
      throw new BotError('duplicate_interaction');
    return intent;
  }
  async confirm(actor: Actor, id: string): Promise<'succeeded' | 'failed' | 'unknown'> {
    this.checkGuild(actor);
    if (!this.writesEnabled) throw new BotError('writes_disabled');
    if (!z.uuid().safeParse(id).success) throw new BotError('invalid_confirmation');
    const intent = await this.persist(() => this.store.getIntent(id));
    if (
      !intent ||
      intent.userId !== actor.userId ||
      intent.guildId !== actor.guildId ||
      intent.state !== 'pending' ||
      new Date(intent.expiresAt) <= this.now()
    )
      throw new BotError('invalid_confirmation');
    await this.authorize(actor, intent.serverId, capabilityFor(intent.action));
    let game: GameServer;
    if (!(await this.persist(() => this.store.claimIntent(id, actor, this.now()))))
      throw new BotError('invalid_confirmation');
    try {
      game = await this.authorize(actor, intent.serverId, capabilityFor(intent.action));
      if (new Date(intent.expiresAt) <= this.now()) throw new BotError('invalid_confirmation');
    } catch (error) {
      await this.persist(() => this.store.finishIntent(id, 'failed', 'authorization_changed'));
      throw error;
    }
    let state: 'succeeded' | 'failed' | 'unknown' = 'succeeded';
    try {
      await game.execute(intent.action);
    } catch (error) {
      state =
        error instanceof Error && 'outcome' in error && error.outcome === 'failed'
          ? 'failed'
          : 'unknown';
    }
    try {
      await this.store.finishIntent(
        id,
        state,
        state === 'succeeded'
          ? 'completed'
          : state === 'failed'
            ? 'upstream_rejected'
            : 'outcome_unknown',
      );
    } catch {
      return 'unknown';
    }
    return state;
  }
  async cancel(actor: Actor, id: string) {
    this.checkGuild(actor);
    if (!z.uuid().safeParse(id).success) throw new BotError('invalid_confirmation');
    return this.persist(() => this.store.cancelIntent(id, actor));
  }
}
