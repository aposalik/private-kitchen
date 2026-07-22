export class AttemptRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => Date,
  ) {}

  consume(keys: readonly string[]): boolean {
    const cutoff = this.now().getTime() - this.windowMs;
    const current = this.now().getTime();
    const windows = keys.map((key) => (this.attempts.get(key) ?? []).filter((time) => time > cutoff));
    if (windows.some((values) => values.length >= this.limit)) return false;
    keys.forEach((key, index) => this.attempts.set(key, [...windows[index]!, current]));
    return true;
  }
}
