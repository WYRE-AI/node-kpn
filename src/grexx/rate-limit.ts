/**
 * Sliding window for the Grexx account path: at most `maxRequests` acquires
 * in any `windowMs` period. The legacy developer.kpn.com client keeps its
 * token-bucket limiter.
 */
export const GREXX_MAX_REQUESTS_PER_WINDOW = 25;
export const GREXX_RATE_WINDOW_MS = 5_000;

export interface SlidingWindowClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SlidingWindowRateLimiter {
  private readonly hits: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Overlapping acquires run one at a time so two callers cannot both pass the cap. */
  private pending: Promise<void> = Promise.resolve();

  constructor(
    maxRequests: number = GREXX_MAX_REQUESTS_PER_WINDOW,
    windowMs: number = GREXX_RATE_WINDOW_MS,
    clock?: Partial<SlidingWindowClock>,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new RangeError('maxRequests must be a positive integer');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('windowMs must be a positive number');
    }
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.now = clock?.now ?? Date.now;
    this.sleep = clock?.sleep ?? defaultSleep;
  }

  async acquire(): Promise<void> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      await this.acquireExclusive();
    } finally {
      release();
    }
  }

  private async acquireExclusive(): Promise<void> {
    for (;;) {
      const now = this.now();
      this.prune(now);
      if (this.hits.length < this.maxRequests) {
        this.hits.push(now);
        return;
      }
      const oldest = this.hits[0]!;
      const waitMs = oldest + this.windowMs - now;
      if (waitMs <= 0) {
        this.hits.shift();
        continue;
      }
      await this.sleep(waitMs);
    }
  }

  /** Drop hits that are no longer inside (now - windowMs, now]. */
  private prune(now: number): void {
    const threshold = now - this.windowMs;
    let drop = 0;
    while (drop < this.hits.length && this.hits[drop]! <= threshold) drop += 1;
    if (drop > 0) this.hits.splice(0, drop);
  }
}
