import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Locale, ServerStatus } from '../contracts.js';

const id = z.string().regex(/^[1-9][0-9]{16,19}$/);
const revision = z.string().regex(/^[1-9][0-9]{0,29}$/);
const text = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s));
const common = {
  schemaVersion: z.literal(1),
  matchId: z.uuid(),
  publicationId: z.uuid(),
  revision,
  locale: z.enum(['cs', 'en']),
};
const published = z
  .object({
    ...common,
    publication: z.literal('published'),
    status: z.enum(['scheduled', 'live', 'completed', 'postponed', 'cancelled']),
    startsAt: z.iso.datetime(),
    timeZone: z.literal('Europe/Prague'),
    publicUrl: z
      .url()
      .max(2048)
      .refine((s) => {
        const u = new URL(s);
        return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
      }),
    game: text,
    opponent: text,
    competition: text,
    signup: z.enum(['open', 'closed']),
    result: z
      .object({
        homeScore: z.number().int().min(0).max(1_000_000),
        awayScore: z.number().int().min(0).max(1_000_000),
        verified: z.literal(true),
        outcome: z.enum(['win', 'loss', 'draw']),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((p) => p.result === null || p.status === 'completed', 'result_requires_completion')
  .refine(
    (p) =>
      !p.result ||
      p.result.outcome ===
        (p.result.homeScore === p.result.awayScore
          ? 'draw'
          : p.result.homeScore > p.result.awayScore
            ? 'win'
            : 'loss'),
    'result_outcome_mismatch',
  )
  .refine((p) => p.signup === 'closed' || p.status === 'scheduled', 'signup_requires_scheduled')
  .refine(
    (p) => new URL(p.publicUrl).pathname.startsWith(`/${p.locale}/matches/`),
    'wrong_locale_path',
  );
export const matchProjectionSchema = z.discriminatedUnion('publication', [
  published,
  z.object({ ...common, publication: z.literal('withdrawn') }).strict(),
]);
export type MatchProjection = z.infer<typeof matchProjectionSchema>;
export const publicationEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.uuid(),
    guildId: id,
    projection: matchProjectionSchema,
  })
  .strict();
export type PublicationEvent = z.infer<typeof publicationEventSchema>;
export const publicationBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicationId: z.uuid(),
    matchId: z.uuid(),
    revision,
    guildId: id,
    channelId: id,
    messageId: id,
    locale: z.enum(['cs', 'en']),
  })
  .strict();
export type PublicationBinding = z.infer<typeof publicationBindingSchema>;
export function parseMatchProjection(value: unknown): MatchProjection {
  return matchProjectionSchema.parse(value);
}
export function parsePublicationEvent(value: unknown): PublicationEvent {
  return publicationEventSchema.parse(value);
}
export interface WebsitePublicationSource {
  latest(matchId: string, locale: Locale): Promise<MatchProjection>;
  bindPublication(binding: PublicationBinding): Promise<void>;
}
export type PublicationPurpose = 'fixture' | 'result' | 'status';
export const destinationSchema = z
  .object({
    guildId: id,
    channelId: id,
    locale: z.enum(['cs', 'en']),
    purpose: z.enum(['fixture', 'result', 'status']),
  })
  .strict();
export type PublicationDestination = z.infer<typeof destinationSchema>;
export interface StatusBoardConfig {
  destination: PublicationDestination;
  serverId: string;
  label: string;
  pollSeconds: number;
  freshForSeconds: number;
}
export interface StatusProjection {
  kind: 'status';
  serverId: string;
  label: string;
  locale: Locale;
  state: 'current' | 'stale' | 'unknown';
  observedAt: string | null;
  validUntil: string | null;
  sample: ServerStatus | null;
}
export type StoredProjection = MatchProjection | StatusProjection;
export interface PublicationPayload {
  content: string;
  embeds: {
    title: string;
    description: string;
    color?: number;
    fields?: { name: string; value: string; inline?: boolean }[];
    url?: string;
  }[];
  components: { type: 1; components: { type: 2; style: 2; label: string; custom_id: string }[] }[];
  attachments: [];
  allowed_mentions: { parse: [] };
}
export interface PublicationTransport {
  create(channelId: string, body: PublicationPayload, nonce: string): Promise<string>;
  edit(channelId: string, messageId: string, body: PublicationPayload): Promise<void>;
}
export interface PublicationJob extends PublicationDestination {
  id: string;
  entityId: string;
  desiredRevision: string;
  projection: StoredProjection;
  messageId: string | null;
  leaseId: string;
  attempts: number;
}
export interface PublicationStore {
  ingest(
    event: PublicationEvent,
    destinations: PublicationDestination[],
  ): Promise<'accepted' | 'duplicate' | 'stale'>;
  claim(now: Date): Promise<PublicationJob | null>;
  refresh(job: PublicationJob, projection: MatchProjection): Promise<boolean>;
  beginAttempt(job: PublicationJob, revision: string): Promise<boolean>;
  canEnableControls(job: PublicationJob, revision: string): Promise<boolean>;
  saveMessageId(job: PublicationJob, messageId: string): Promise<void>;
  finish(
    job: PublicationJob,
    revision: string,
    state: 'delivered' | 'suppressed' | 'unknown' | 'failed',
    code: string,
  ): Promise<void>;
  retry(job: PublicationJob, nextAttempt: Date, code: string): Promise<void>;
  recover(): Promise<number>;
  status(serverId: string, locale: Locale): Promise<StatusProjection | null>;
  observeStatus(
    destination: PublicationDestination,
    projection: StatusProjection,
    heartbeatMs: number,
    now: Date,
  ): Promise<boolean>;
}
export function digest(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  );
  return createHash('sha256').update(json).digest('hex');
}
export function publicationNonce(bindingId: string): string {
  return createHash('sha256').update(bindingId).digest('base64url').slice(0, 25);
}
