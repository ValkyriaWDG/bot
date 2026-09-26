import { RateLimitError } from 'discord.js';
import type { PublicationPayload, PublicationTransport } from './contracts.js';

export interface DiscordRestFacade {
  post(
    route: `/channels/${string}/messages`,
    options: { body: unknown; signal: AbortSignal },
  ): Promise<unknown>;
  patch(
    route: `/channels/${string}/messages/${string}`,
    options: { body: unknown; signal: AbortSignal },
  ): Promise<unknown>;
}
export class PublicationTransportError extends Error {
  constructor(
    readonly code: 'rate_limited' | 'deleted' | 'forbidden' | 'rejected' | 'uncertain',
    readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}
function classify(error: unknown): PublicationTransportError {
  if (error instanceof PublicationTransportError) return error;
  const e = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  if (e.status === 429 || error instanceof RateLimitError) {
    const seconds = typeof e.retry_after === 'number' ? e.retry_after * 1000 : 0;
    const milliseconds = Math.max(
      typeof e.timeToReset === 'number' ? e.timeToReset : 0,
      typeof e.retryAfter === 'number' ? e.retryAfter : 0,
      typeof e.sublimitTimeout === 'number' ? e.sublimitTimeout : 0,
    );
    return new PublicationTransportError('rate_limited', Math.max(1000, seconds, milliseconds));
  }
  if (e.status === 404 || e.code === 10008) return new PublicationTransportError('deleted');
  if (e.status === 401 || e.status === 403) return new PublicationTransportError('forbidden');
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500)
    return new PublicationTransportError('rejected');
  return new PublicationTransportError('uncertain');
}
/** The runtime REST client must disable automatic retries and reject rate limits. */
export class DiscordPublicationTransport implements PublicationTransport {
  constructor(private readonly rest: DiscordRestFacade) {}
  async create(channelId: string, body: PublicationPayload, nonce: string): Promise<string> {
    if (!/^[1-9][0-9]{16,19}$/.test(channelId) || !/^[A-Za-z0-9_-]{1,25}$/.test(nonce))
      throw new PublicationTransportError('rejected');
    try {
      const result = await this.rest.post(`/channels/${channelId}/messages`, {
        body: { ...body, nonce, enforce_nonce: true },
        signal: AbortSignal.timeout(10_000),
      });
      const id =
        result && typeof result === 'object' ? (result as Record<string, unknown>).id : undefined;
      if (typeof id !== 'string' || !/^[1-9][0-9]{16,19}$/.test(id))
        throw new PublicationTransportError('uncertain');
      return id;
    } catch (error) {
      throw classify(error);
    }
  }
  async edit(channelId: string, messageId: string, body: PublicationPayload): Promise<void> {
    if (![channelId, messageId].every((s) => /^[1-9][0-9]{16,19}$/.test(s)))
      throw new PublicationTransportError('rejected');
    try {
      await this.rest.patch(`/channels/${channelId}/messages/${messageId}`, {
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw classify(error);
    }
  }
}
