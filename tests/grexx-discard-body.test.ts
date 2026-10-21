import { describe, expect, it, vi } from 'vitest';

import { GREXX_BODY_DISCARD_FAILED, discardBody } from '../src/grexx/errors.js';
import { failingCancelResponse } from './grexx-fetch.js';

describe('discardBody', () => {
  it('reports only the fixed message when cancel rejects', async () => {
    const reporter = vi.fn();
    await expect(discardBody(failingCancelResponse(), reporter)).resolves.toBeUndefined();
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0]).toEqual([GREXX_BODY_DISCARD_FAILED]);
  });

  it('never rejects when the reporter throws', async () => {
    await expect(
      discardBody(failingCancelResponse(), () => {
        throw new Error('reporter boom');
      }),
    ).resolves.toBeUndefined();
  });

  it('does not call the reporter on success', async () => {
    const reporter = vi.fn();
    await discardBody(new Response('x', { status: 302 }), reporter);
    expect(reporter).not.toHaveBeenCalled();
  });
});
