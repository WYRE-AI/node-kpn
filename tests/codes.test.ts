import { describe, expect, it } from 'vitest';

import { describeGrexxCode } from '../src/index.js';

describe('describeGrexxCode', () => {
  it('maps success, the unknown RoutIT error, and gateway codes 100–109', () => {
    expect(describeGrexxCode(0)).toMatchObject({ category: 'success', message: 'Success' });
    expect(describeGrexxCode(68)).toMatchObject({
      category: 'gateway',
      message: 'Error',
      detail: 'Error — unknown RoutIT error',
    });
    for (let code = 100; code <= 109; code += 1) {
      expect(describeGrexxCode(code).category).toBe('gateway');
      expect(describeGrexxCode(code).message.length).toBeGreaterThan(0);
    }
    expect(describeGrexxCode(101).message).toBe('Authorization scheme basic required');
    expect(describeGrexxCode(108).message).toBe('Too Many Requests');
  });

  it('maps IRMA order statuses and leaves other RoutIT codes unmarked', () => {
    expect(describeGrexxCode(201)).toMatchObject({ category: 'order', message: 'Active' });
    expect(describeGrexxCode(203).category).toBe('order');
    expect(describeGrexxCode(204)).toMatchObject({ category: 'order', message: 'Accepted' });
    for (const code of [205, 207, 208, 209, 213, 214]) {
      expect(describeGrexxCode(code).category).toBe('order');
    }
    expect(describeGrexxCode(5000).category).toBe('routit');
  });
});
