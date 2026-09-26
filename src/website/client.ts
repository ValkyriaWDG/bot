import { createHmac, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Locale } from '../contracts.js';
import {
  matchProjectionSchema,
  publicationBindingSchema,
  publicationEventSchema,
  type MatchProjection,
  type PublicationBinding,
  type WebsitePublicationSource,
} from '../publications/contracts.js';
import {
  signupCommandSchema,
  signupContextSchema,
  signupRequestSchema,
  signupResultSchema,
  type SignupCommand,
  type SignupContext,
  type SignupRequest,
  type SignupResult,
  type SignupWebsite,
} from '../signup/contracts.js';

export class WebsiteError extends Error {
  constructor(
    readonly code:
      'website_configuration' | 'website_request' | 'website_unavailable' | 'website_unknown',
  ) {
    super(code);
  }
}
export interface WebsiteClientConfig {
  origin: string;
  keys: Record<'publications' | 'signup', { keyId: string; secret: string }>;
  timeoutMs?: number;
}
export interface WebsiteClientOptions {
  /** Only enables literal loopback HTTP fixtures; production still requires HTTPS. */
  allowLoopbackHttp?: boolean;
  /** Fixture transport only. Retains config.origin for validating public website links. */
  loopbackOrigin?: string;
  now?: () => Date;
  nonce?: () => string;
}
const basePath = '/api/integrations/discord/v1';
const cursorSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const pageSchema = z
  .object({
    schemaVersion: z.literal(1),
    events: z.array(publicationEventSchema).max(50),
    nextCursor: cursorSchema,
  })
  .strict();
export type PublicationEventPage = z.infer<typeof pageSchema>;
const ackSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('bound'),
    binding: publicationBindingSchema,
  })
  .strict();
const maxBytes = 256 * 1024;
export function websiteOrigin(value: string, allowLoopbackHttp = false): string {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !(
        url.protocol === 'https:' ||
        (allowLoopbackHttp &&
          url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(url.hostname))
      )
    )
      throw Error('invalid');
    return url.origin;
  } catch {
    throw new WebsiteError('website_configuration');
  }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WebsiteError('website_request');
  return parsed.data;
}
async function readJson(response: globalThis.Response): Promise<unknown> {
  if (
    response.status !== 200 ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
    Number(response.headers.get('content-length') ?? 0) > maxBytes
  ) {
    await response.body?.cancel();
    throw Error('invalid_response');
  }
  if (!response.body) throw Error('empty_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw Error('response_too_large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
/** Bot-side proposed protocol. This does not implement or attest the website receiver. */
export class WebsiteClient implements SignupWebsite, WebsitePublicationSource {
  private readonly origin: string;
  private readonly transportOrigin: string;
  private readonly keys: WebsiteClientConfig['keys'];
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly nonce: () => string;
  constructor(config: WebsiteClientConfig, options: WebsiteClientOptions = {}) {
    this.origin = websiteOrigin(config.origin, options.allowLoopbackHttp);
    this.transportOrigin = this.origin;
    if (options.loopbackOrigin !== undefined) {
      const target = websiteOrigin(options.loopbackOrigin, true);
      if (
        !options.allowLoopbackHttp ||
        !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(target)
      )
        throw new WebsiteError('website_configuration');
      this.transportOrigin = target;
    }
    this.timeoutMs = config.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 10000)
      throw new WebsiteError('website_configuration');
    for (const key of [config.keys?.publications, config.keys?.signup]) {
      if (
        !key ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(key.keyId) ||
        typeof key.secret !== 'string' ||
        Buffer.byteLength(key.secret, 'utf8') < 32 ||
        Buffer.byteLength(key.secret, 'utf8') > 4096
      )
        throw new WebsiteError('website_configuration');
    }
    if (
      config.keys.publications.keyId === config.keys.signup.keyId ||
      config.keys.publications.secret === config.keys.signup.secret
    )
      throw new WebsiteError('website_configuration');
    this.keys = {
      publications: { ...config.keys.publications },
      signup: { ...config.keys.signup },
    };
    this.now = options.now ?? (() => new Date());
    this.nonce = options.nonce ?? (() => randomBytes(16).toString('hex'));
  }
  private async request<T>(
    purpose: keyof WebsiteClientConfig['keys'],
    method: 'GET' | 'POST',
    path: string,
    body: unknown | undefined,
    mutation: boolean,
    schema: z.ZodType<T>,
    validate: (value: T) => boolean,
  ): Promise<T> {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    if (Buffer.byteLength(rawBody) > maxBytes) throw new WebsiteError('website_request');
    const key = this.keys[purpose];
    const timestamp = String(Math.floor(this.now().getTime() / 1000));
    const nonce = this.nonce();
    if (!/^[0-9]{10,12}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce))
      throw new WebsiteError('website_configuration');
    const signature = createHmac('sha256', key.secret)
      .update(['1', purpose, method, path, key.keyId, timestamp, nonce, rawBody].join('\n'))
      .digest('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.transportOrigin}${path}`, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-valkyria-version': '1',
          'x-valkyria-purpose': purpose,
          'x-valkyria-key-id': key.keyId,
          'x-valkyria-timestamp': timestamp,
          'x-valkyria-nonce': nonce,
          'x-valkyria-signature': signature,
        },
        ...(method === 'POST' ? { body: rawBody } : {}),
      });
      const parsed = schema.safeParse(await readJson(response));
      if (!parsed.success || !validate(parsed.data)) throw Error('invalid_response');
      return parsed.data;
    } catch {
      throw new WebsiteError(mutation ? 'website_unknown' : 'website_unavailable');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async events(after: string): Promise<PublicationEventPage> {
    input(cursorSchema, after);
    return this.request(
      'publications',
      'GET',
      `${basePath}/publication-events?after=${after}`,
      undefined,
      false,
      pageSchema,
      (page) =>
        BigInt(page.nextCursor) >= BigInt(after) &&
        (page.events.length === 0 || BigInt(page.nextCursor) > BigInt(after)) &&
        new Set(page.events.map((event) => event.eventId)).size === page.events.length,
    );
  }
  async latest(matchId: string, locale: Locale): Promise<MatchProjection> {
    input(z.uuid(), matchId);
    input(z.enum(['cs', 'en']), locale);
    return this.request(
      'publications',
      'GET',
      `${basePath}/matches/${matchId}/publication/${locale}`,
      undefined,
      false,
      matchProjectionSchema,
      (projection) =>
        projection.matchId === matchId &&
        projection.locale === locale &&
        (projection.publication === 'withdrawn' ||
          new URL(projection.publicUrl).origin === this.origin),
    );
  }
  async bindPublication(binding: PublicationBinding): Promise<void> {
    const validated = input(publicationBindingSchema, binding);
    await this.request(
      'publications',
      'POST',
      `${basePath}/publication-bindings`,
      validated,
      true,
      ackSchema,
      (ack) => isDeepStrictEqual(ack.binding, validated),
    );
  }
  async context(request: SignupRequest): Promise<SignupContext> {
    const validated = input(signupRequestSchema, request);
    return this.request(
      'signup',
      'POST',
      `${basePath}/signup/context`,
      validated,
      false,
      signupContextSchema,
      (context) => isDeepStrictEqual(context.request, validated),
    );
  }
  async participate(command: SignupCommand): Promise<SignupResult> {
    const validated = input(signupCommandSchema, command);
    return this.request(
      'signup',
      'POST',
      `${basePath}/signup/participation`,
      validated,
      true,
      signupResultSchema,
      (result) => isDeepStrictEqual(result.command, validated),
    );
  }
}
