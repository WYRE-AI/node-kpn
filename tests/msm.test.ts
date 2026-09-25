import { describe, expect, it } from 'vitest';

import { buildFilters, referenceNumber } from '../src/index.js';

describe('buildFilters', () => {
  it('builds COL: "value" clauses joined by "; "', () => {
    expect(buildFilters({ FIRSTNAME: ['Jan'], MOBILE_NUMBER: ['0612345678'] })).toBe(
      'FIRSTNAME: "Jan"; MOBILE_NUMBER: "0612345678"'
    );
  });

  it('joins several values for one column with ", "', () => {
    expect(buildFilters({ STATE: ['ACTIVE', 'BLOCKED'] })).toBe('STATE: "ACTIVE", "BLOCKED"');
  });

  it('escapes inner quotes and backslashes', () => {
    expect(buildFilters({ LASTNAME: ['de "Vries"\\x'] })).toBe('LASTNAME: "de \\"Vries\\"\\\\x"');
  });

  it('drops empty arrays and undefined; returns undefined when nothing remains', () => {
    expect(buildFilters({ A: [], B: undefined, C: ['c'] })).toBe('C: "c"');
    expect(buildFilters({ A: [], B: undefined })).toBeUndefined();
    expect(buildFilters({})).toBeUndefined();
  });
});

describe('referenceNumber', () => {
  it('is WYRE- + UTC yyyyMMddHHmmss and ≤ 25 chars', () => {
    const ref = referenceNumber(new Date(Date.UTC(2026, 8, 25, 7, 5, 9)));
    expect(ref).toBe('WYRE-20260925070509');
    expect(ref.length).toBeLessThanOrEqual(25);
  });

  it('defaults to now', () => {
    expect(referenceNumber()).toMatch(/^WYRE-\d{14}$/);
  });
});
