import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../src/index.js';

describe('RateLimiter', () => {
  it('allows a burst up to maxRequests without waiting', async () => {
    const limiter = new RateLimiter(5, 1_000);
    const start = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('waits once the bucket is exhausted', async () => {
    const limiter = new RateLimiter(2, 200);
    await limiter.acquire();
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire(); // must wait ~one token interval (100ms)
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it('refills over time', async () => {
    const limiter = new RateLimiter(2, 100);
    await limiter.acquire();
    await limiter.acquire();
    await new Promise((r) => setTimeout(r, 150)); // full window elapsed → bucket refilled
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
