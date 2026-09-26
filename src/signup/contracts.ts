import { z } from 'zod';

const snowflake = z.string().regex(/^[1-9][0-9]{16,19}$/);
export const revisionSchema = z.string().regex(/^[1-9][0-9]{0,29}$/);
export const signupRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicationId: z.uuid(),
    locale: z.enum(['cs', 'en']),
    guildId: snowflake,
    userId: snowflake,
    interactionId: snowflake,
    channelId: snowflake,
    messageId: snowflake,
  })
  .strict();
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export const signupCommandSchema = signupRequestSchema
  .extend({
    action: z.enum(['join', 'withdraw']),
    expectedRevision: revisionSchema,
    idempotencyKey: z.string().max(62),
  })
  .refine(
    (c) => c.idempotencyKey === `${c.guildId}:${c.userId}:${c.interactionId}`,
    'idempotency_identity',
  );
export type SignupCommand = z.infer<typeof signupCommandSchema>;
const participation = z.enum(['none', 'joined', 'waitlisted', 'withdrawn']);
export const signupContextSchema = z.discriminatedUnion('state', [
  z
    .object({
      schemaVersion: z.literal(1),
      request: signupRequestSchema,
      state: z.literal('ready'),
      matchId: z.uuid(),
      revision: revisionSchema,
      signup: z.enum(['open', 'locked', 'closed']),
      participation,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      request: signupRequestSchema,
      state: z.enum(['unlinked', 'ineligible', 'obsolete']),
      matchId: z.null(),
      revision: z.null(),
      signup: z.null(),
      participation: z.null(),
    })
    .strict(),
]);
export type SignupContext = z.infer<typeof signupContextSchema>;
export const signupResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(1),
      command: signupCommandSchema,
      status: z.literal('committed'),
      participation,
      revision: revisionSchema,
      committedAt: z.iso.datetime(),
    })
    .strict()
    .refine(
      (r) =>
        r.command.action === 'join'
          ? ['joined', 'waitlisted'].includes(r.participation)
          : ['none', 'withdrawn'].includes(r.participation),
      'action_outcome_mismatch',
    ),
  z
    .object({
      schemaVersion: z.literal(1),
      command: signupCommandSchema,
      status: z.literal('rejected'),
      reason: z.enum([
        'unlinked',
        'ineligible',
        'obsolete',
        'closed',
        'locked',
        'stale_revision',
        'idempotency_conflict',
      ]),
    })
    .strict(),
]);
export type SignupResult = z.infer<typeof signupResultSchema>;
export interface SignupWebsite {
  context(request: SignupRequest): Promise<SignupContext>;
  participate(command: SignupCommand): Promise<SignupResult>;
}
