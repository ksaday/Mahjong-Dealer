// Rate limits (docs/13_Input_Integrity.md §10). All in-process, per
// connection — these are the limits explicitly *not* the durable,
// security-critical one (login lockout), which docs/15 §7 requires to
// live in PostgreSQL precisely because an in-memory limit vanishes on
// restart (an attacker simply waits it out). These limits stop scripts,
// not fast players (D-13-11), so vanishing on restart costs nothing worse
// than a brief window of unthrottled-but-still-authorized commands.
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  tryConsume(count = 1): boolean {
    const elapsedSeconds = (this.now() - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = this.now();
    if (this.tokens < count) {
      return false;
    }
    this.tokens -= count;
    return true;
  }
}

/** Commands per connection: 5/s, burst 10 (docs/13 §10). */
export function createCommandRateLimiter(now?: () => number): TokenBucket {
  return new TokenBucket(10, 5, now);
}
