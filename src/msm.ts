/**
 * Mobile Services Management (MSM) paging: index window `from` (inclusive,
 * default 0) and `to` (exclusive, default 20). Responses are `{ result, total }`.
 */
export interface MsmPageParams {
  from?: number;
  to?: number;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
}

/**
 * Build the MSM `filters` DSL string, e.g.
 * `{ FIRSTNAME: ['Jan'], MOBILE_NUMBER: ['0612345678'] }` →
 * `FIRSTNAME: "Jan"; MOBILE_NUMBER: "0612345678"`, and several values for one
 * column as `COL: "a", "b"`.
 *
 * Values are double-quoted with inner quotes and backslashes escaped; empty
 * arrays and undefined are dropped; returns undefined when nothing remains.
 * The syntax comes from spec prose only — this is the one place to fix it.
 */
export function buildFilters(filters: Record<string, Array<string> | undefined>): string | undefined {
  const clauses: string[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (!values || values.length === 0) continue;
    const quoted = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    clauses.push(`${column}: ${quoted.join(', ')}`);
  }
  return clauses.length > 0 ? clauses.join('; ') : undefined;
}

/** Default MSM `referenceNumber` (≤ 25 chars): `WYRE-` + UTC yyyyMMddHHmmss. */
export function referenceNumber(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `WYRE-${stamp}`;
}
