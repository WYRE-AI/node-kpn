import { describe, expect, it } from 'vitest';

import { SlidingWindowRateLimiter } from '../src/grexx/rate-limit.js';

function fakeClock(start = 0): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe('SlidingWindowRateLimiter', () => {
  it('admits at most 25 acquires in any 5 second window', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(25, 5_000, clock);

    for (let i = 0; i < 25; i += 1) await limiter.acquire();
    expect(clock.sleeps).toEqual([]);

    await limiter.acquire();
    expect(clock.sleeps).toEqual([5_000]);

    clock.sleeps.length = 0;
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('does not let concurrent acquires exceed the window', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(25, 5_000, clock);

    await Promise.all(Array.from({ length: 30 }, () => limiter.acquire()));
    expect(clock.sleeps).toEqual([5_000]);
  });

  it('waits only until the oldest hit leaves the window', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new SlidingWindowRateLimiter(2, 1_000, {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    await limiter.acquire();
    now = 400;
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([600]);
  });
});
