import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PHASE1_RESPONSE_ROOTS, PHASE1_ROOTS, parseXmlDocument, type ParsedElement } from '../src/index.js';

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '../schemas/grexx');

function rootElementName(node: ParsedElement): string | undefined {
  for (const child of node.children) {
    const local = child.name.slice(child.name.lastIndexOf(':') + 1);
    if (local === 'element' && child.attributes['name']) return child.attributes['name'];
  }
  return undefined;
}

describe('schemas/grexx', () => {
  const files = readdirSync(schemaDir).filter((name) => name.endsWith('.xsd'));

  it('stores a request XSD for every Phase 1 root and the published response XSDs', () => {
    for (const root of Object.values(PHASE1_ROOTS)) {
      expect(files).toContain(`${root}.xsd`);
    }
    for (const root of Object.values(PHASE1_RESPONSE_ROOTS)) {
      expect(files).toContain(`${root}.xsd`);
    }
    expect(files).not.toContain('GetSimCardRequest_V1.xsd');
    expect(files).not.toContain('OrderSummaryResponse_V1.xsd');
    expect(files).not.toContain('GetMobileSubscriptionOrdersResponse_V1.xsd');
    expect(files).toContain('ZipCodeCheckResponse_V5.xsd');
    expect(files).not.toContain('ZipCodeCheckResponse_V6.xsd');
  });

  it('parses each schema and finds the global element named by the file', () => {
    for (const file of files) {
      const xml = readFileSync(join(schemaDir, file), 'utf8');
      const doc = parseXmlDocument(xml);
      expect(doc.name.endsWith('schema')).toBe(true);
      expect(rootElementName(doc)).toBe(file.replace(/\.xsd$/, ''));
    }
  });
});
