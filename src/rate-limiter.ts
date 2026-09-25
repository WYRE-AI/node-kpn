/**
 * Token-bucket rate limiter. KPN publishes no numeric limits (quotas surface
 * only as `quota-*` response headers), so the client defaults to a
 * conservative 25 requests / 5 s (5 rps sustained) shared by both realms.
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
