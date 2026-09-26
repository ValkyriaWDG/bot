import type { Pool } from 'pg';
import type { Actor, BotConfig, MembershipProvider } from '../contracts.js';

export type ManagementScope = 'bot.read' | 'bot.configure';
export interface ManagementConfig {
  keys: Record<string, { secret: string; scopes: ManagementScope[] }>;
  grants: Record<ManagementScope, string[]>;
}
export interface ManagementSettings {
  defaultLocale: 'cs' | 'en';
  serverLabels: Record<string, string>;
}
export interface ManagementSettingsSnapshot {
  revision: string;
  settings: ManagementSettings;
}
export interface ManagementRuntime {
  build: { version: string; revision: string };
  startedAt: string;
  observedAt: string;
  discord: 'connected' | 'disconnected' | 'unknown';
  database: 'available' | 'unavailable' | 'unknown';
  lease: 'held' | 'lost' | 'unknown';
  effective: ManagementSettingsSnapshot | null;
}
export interface ManagementOptions {
  pool: Pool;
  botConfig: BotConfig;
  members: MembershipProvider;
  config: ManagementConfig;
  getRuntime: () => ManagementRuntime;
  applySettings: (snapshot: ManagementSettingsSnapshot) => void | Promise<void>;
  now?: () => Date;
  requestTimeoutMs?: number;
  rateLimitPerMinute?: number;
}
export interface ManagementIdentity {
  actor: Actor;
  keyId: string;
  scope: ManagementScope;
  nonce: string;
  method: string;
  path: string;
  bodyDigest: string;
  expiresAt: number;
}
export class ManagementError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
  }
}
