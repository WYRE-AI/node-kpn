/**
 * Token-bucket rate limiter. Grexx signals overload with gateway code 108
 * (Too Many Requests). The published acceptatie/production spreadsheet is not
 * encoded here, so the client stays conservative: 25 requests / 5 s.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 25, windowMs: number = 5_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
  }

  /** Resolve when a request is allowed to proceed, consuming one token. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const msPerToken = this.windowMs / this.maxRequests;
    const waitMs = Math.ceil((1 - this.tokens) * msPerToken);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.acquire();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxRequests,
      this.tokens + (elapsed * this.maxRequests) / this.windowMs
    );
    this.lastRefill = now;
  }
}
