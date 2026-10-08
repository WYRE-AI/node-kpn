import type { XmlNode, XmlObject } from './xml.js';

/**
 * Positive IRMA / ZipCodeCheck outcomes.
 * `Success` is what acceptatie returned for ZipCodeCheck (2026-10-07).
 * `0` is the legacy success code. `201` / `204` are queued accepted/active states.
 */
const SUCCESS_CODES = new Set(['success', '0', '201', '204', 'accepted', 'active']);

export function isGrexxSuccessCode(code: string): boolean {
  return SUCCESS_CODES.has(code.trim().toLowerCase());
}

function asObject(node: XmlNode | undefined): XmlObject | undefined {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) return node;
  return undefined;
}

function stringList(node: XmlNode | undefined): string[] {
  const record = asObject(node);
  if (!record) return [];
  const value = record['string'];
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** Read `Status/Code` and `Status/Messages/string` from a parsed Grexx document. */
export function readGrexxStatus(document: XmlObject): { code?: string; messages: string[] } {
  const roots = Object.values(document);
  const root = roots.length === 1 ? asObject(roots[0]) : undefined;
  const status = asObject(root?.['Status']) ?? asObject(document['Status']);
  if (!status) return { messages: [] };
  const code = typeof status['Code'] === 'string' ? status['Code'].trim() : '';
  return {
    code: code.length > 0 ? code : undefined,
    messages: stringList(status['Messages']),
  };
}
