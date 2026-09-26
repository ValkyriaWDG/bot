export type Locale = 'cs' | 'en';
export type Capability =
  'server.status' | 'server.players' | 'server.broadcast' | 'server.moderate' | 'server.control';
export interface Actor {
  guildId: string;
  userId: string;
}
export interface Membership extends Actor {
  roleIds: string[];
  state: 'present' | 'left';
  observedAt: string;
}
export interface MembershipProvider {
  fetch(guildId: string, userId: string): Promise<Membership>;
}
export type ServerAction =
  | { type: 'broadcast'; message: string }
  | { type: 'kick'; steamId: string; reason: string }
  | { type: 'ban'; steamId: string; reason: string }
  | { type: 'unban'; steamId: string }
  | { type: 'map'; map: string }
  | { type: 'restart' };
export interface ServerStatus {
  serverName: string;
  map: string;
  playerCount: number;
  maxPlayers: number;
  matchSeconds: number | null;
}
export interface Player {
  steamId: string | null;
  name: string;
  faction: string;
  kills: number;
  deaths: number;
  pingMs: number;
}
export interface GameServer {
  status(): Promise<ServerStatus>;
  players(): Promise<Player[]>;
  execute(action: ServerAction): Promise<void>;
}
export interface ServerConfig {
  id: string;
  label: string;
  baseUrl: string;
  tokenEnv: string;
  grants: Partial<Record<Capability, string[]>>;
}
export interface BotConfig {
  guildId: string;
  applicationId: string;
  defaultLocale: Locale;
  websiteUrl: string;
  servers: ServerConfig[];
  roleSync: {
    enabled: boolean;
    url: string;
    keyId: string;
    secretEnv: string;
    reconcileSeconds: number;
  };
}
export interface RoleSyncEvent {
  schemaVersion: 1;
  eventId: string;
  guildId: string;
  userId: string;
  roleIds: string[];
  membershipState: 'present' | 'left';
  observedAt: string;
  sequence: string;
}
export interface OutboxItem {
  event: RoleSyncEvent;
  attempts: number;
  leaseId: string;
}
export interface SyncStore {
  saveMembership(member: Membership): Promise<RoleSyncEvent>;
  trackedMembers(limit: number, afterUserId?: string): Promise<string[]>;
  claimOutbox(now: Date, limit: number): Promise<OutboxItem[]>;
  completeOutbox(eventId: string, leaseId: string): Promise<void>;
  retryOutbox(eventId: string, leaseId: string, nextAttempt: Date, code: string): Promise<void>;
  failOutbox(eventId: string, leaseId: string, code: string): Promise<void>;
}
export type ActionState =
  'pending' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
export interface Intent extends Actor {
  id: string;
  interactionId: string;
  serverId: string;
  action: ServerAction;
  expiresAt: string;
  state: ActionState;
}
export interface ActionStore {
  createIntent(intent: Intent): Promise<boolean>;
  getIntent(id: string): Promise<Intent | null>;
  claimIntent(id: string, actor: Actor, now: Date): Promise<boolean>;
  finishIntent(id: string, state: 'succeeded' | 'failed' | 'unknown', code: string): Promise<void>;
  cancelIntent(id: string, actor: Actor): Promise<boolean>;
  audit(actor: Actor, action: string, serverId: string | null, code: string): Promise<void>;
}
