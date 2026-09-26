export interface PublicationPage {
  events: unknown[];
  nextCursor: string;
}
export interface PublicationCursorStore {
  read(): Promise<string>;
  advance(expected: string, next: string): Promise<boolean>;
}
export class PublicationIngress {
  private busy = false;
  constructor(
    private options: {
      enabled: boolean;
      source: { events(after: string): Promise<PublicationPage> };
      consumer: { accept(event: unknown): Promise<unknown> };
      store: PublicationCursorStore;
    },
  ) {}

  async tick(): Promise<{ accepted: number; state: 'disabled' | 'busy' | 'accepted' }> {
    if (!this.options.enabled) return { accepted: 0, state: 'disabled' };
    if (this.busy) return { accepted: 0, state: 'busy' };
    this.busy = true;
    try {
      const cursor = await this.options.store.read();
      const page = await this.options.source.events(cursor);
      if (
        !/^(0|[1-9][0-9]{0,29})$/.test(cursor) ||
        !/^(0|[1-9][0-9]{0,29})$/.test(page.nextCursor) ||
        !Array.isArray(page.events) ||
        page.events.length > 50 ||
        BigInt(page.nextCursor) < BigInt(cursor) ||
        (page.events.length > 0 && BigInt(page.nextCursor) === BigInt(cursor))
      ) {
        throw new Error('invalid_publication_page');
      }
      for (const event of page.events) await this.options.consumer.accept(event);
      if (!(await this.options.store.advance(cursor, page.nextCursor)))
        throw new Error('publication_cursor_conflict');
      return { accepted: page.events.length, state: 'accepted' };
    } finally {
      this.busy = false;
    }
  }
}
