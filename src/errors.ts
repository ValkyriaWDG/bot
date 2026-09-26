export class BotError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'BotError';
  }
}
