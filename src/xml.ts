/** XML declaration used on every built request. Encoding matches UTF-8 bodies. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

export type XmlPrimitive = string | number | boolean;

export type XmlValue = XmlPrimitive | XmlObject | XmlValue[];

export interface XmlObject {
  [key: string]: XmlValue | undefined;
}

const XML_NAME = /^[A-Za-z_][\w.-]*$/;

export function assertXmlName(name: string): void {
  if (!XML_NAME.test(name)) {
    throw new Error(`Invalid XML name "${name}".`);
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function serializeFields(fields: XmlObject): string {
  let xml = '';
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    xml += serializeValue(key, value);
  }
  return xml;
}

function serializeValue(name: string, value: XmlValue): string {
  assertXmlName(name);
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(name, item)).join('');
  }
  if (typeof value === 'object') {
    return `<${name}>${serializeFields(value)}</${name}>`;
  }
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Plain XML document. No SOAP envelope. Empty fields produce a self-closing root. */
export function buildRequestXml(rootElement: string, fields: XmlObject): string {
  assertXmlName(rootElement);
  const inner = serializeFields(fields);
  const element = inner ? `<${rootElement}>${inner}</${rootElement}>` : `<${rootElement}/>`;
  return `${XML_DECLARATION}\n${element}`;
}

function containsRoot(xml: string, rootElement: string): boolean {
  return new RegExp(`<${rootElement}(\\s|/|>)`).test(xml);
}

/**
 * Object fields become child elements of `rootElement`.
 * A string is sent as-is when it already contains that root; otherwise it is
 * wrapped as inner XML. A full document with a different root is rejected.
 */
export function resolveRequestBody(rootElement: string, body: XmlObject | string): string {
  assertXmlName(rootElement);
  if (typeof body !== 'string') return buildRequestXml(rootElement, body);

  const trimmed = body.trim();
  if (!trimmed) return buildRequestXml(rootElement, {});
  if (containsRoot(trimmed, rootElement)) {
    return trimmed.startsWith('<?xml') ? trimmed : `${XML_DECLARATION}\n${trimmed}`;
  }
  if (trimmed.startsWith('<?xml')) {
    throw new Error(`XML document root does not match ${rootElement}.`);
  }
  if (trimmed.startsWith('<')) {
    return `${XML_DECLARATION}\n<${rootElement}>${trimmed}</${rootElement}>`;
  }
  throw new Error('XML string body must be a fragment or a document.');
}

export interface ParsedElement {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: ParsedElement[];
}

/**
 * Minimal XML parser for IRMA responses. No DTDs, no external entities.
 * Repeated sibling elements become arrays; attributes land under `@attributes`.
 */
export function parseXmlDocument(xml: string): ParsedElement {
  const src = xml.replace(/^\uFEFF/, '');
  let i = 0;

  function eof(): boolean {
    return i >= src.length;
  }
  function startsWith(token: string): boolean {
    return src.startsWith(token, i);
  }
  function skipWs(): void {
    while (!eof() && /\s/.test(src[i]!)) i += 1;
  }
  function fail(message: string): never {
    throw new Error(`${message} at offset ${i}.`);
  }

  function skipMisc(): void {
    for (;;) {
      skipWs();
      if (startsWith('<?')) {
        const end = src.indexOf('?>', i);
        if (end < 0) fail('Unclosed XML processing instruction');
        i = end + 2;
        continue;
      }
      if (startsWith('<!--')) {
        const end = src.indexOf('-->', i);
        if (end < 0) fail('Unclosed XML comment');
        i = end + 3;
        continue;
      }
      if (startsWith('<!DOCTYPE') || startsWith('<!doctype')) {
        fail('DTD declarations are not supported');
      }
      break;
    }
  }

  function parseName(): string {
    const start = i;
    if (eof() || !/[A-Za-z_:]/.test(src[i]!)) fail('Expected an XML name');
    i += 1;
    while (!eof() && /[\w.:-]/.test(src[i]!)) i += 1;
    return src.slice(start, i);
  }

  function parseEntity(): string {
    const semi = src.indexOf(';', i);
    if (semi < 0 || semi - i > 12) fail('Bad XML entity');
    const token = src.slice(i, semi + 1);
    i = semi + 1;
    switch (token) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default: {
        if (/^&#x[0-9a-fA-F]+;$/.test(token)) {
          return String.fromCodePoint(Number.parseInt(token.slice(3, -1), 16));
        }
        if (/^&#[0-9]+;$/.test(token)) {
          return String.fromCodePoint(Number.parseInt(token.slice(2, -1), 10));
        }
        fail(`Unknown XML entity ${token}`);
      }
    }
  }

  function parseAttrValue(): string {
    const quote = src[i];
    if (quote !== '"' && quote !== "'") fail('Expected a quoted attribute');
    i += 1;
    let out = '';
    while (!eof() && src[i] !== quote) {
      if (src[i] === '&') out += parseEntity();
      else out += src[i++];
    }
    if (src[i] !== quote) fail('Unclosed attribute');
    i += 1;
    return out;
  }

  function parseElement(): ParsedElement {
    if (src[i] !== '<') fail('Expected <');
    i += 1;
    if (src[i] === '/' || src[i] === '!' || src[i] === '?') fail('Expected an element');
    const name = parseName();
    const attributes: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (startsWith('/>')) {
        i += 2;
        return { name, attributes, text: '', children: [] };
      }
      if (src[i] === '>') {
        i += 1;
        break;
      }
      const attr = parseName();
      skipWs();
      if (src[i] !== '=') fail('Expected =');
      i += 1;
      skipWs();
      attributes[attr] = parseAttrValue();
    }

    let text = '';
    const children: ParsedElement[] = [];
    while (!eof()) {
      if (startsWith('</')) {
        i += 2;
        const endName = parseName();
        if (endName !== name) fail(`Mismatched end tag ${endName} for ${name}`);
        skipWs();
        if (src[i] !== '>') fail('Expected >');
        i += 1;
        return { name, attributes, text, children };
      }
      if (startsWith('<![CDATA[')) {
        const end = src.indexOf(']]>', i);
        if (end < 0) fail('Unclosed CDATA');
        text += src.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (startsWith('<!--')) {
        const end = src.indexOf('-->', i);
        if (end < 0) fail('Unclosed XML comment');
        i = end + 3;
        continue;
      }
      if (startsWith('<?')) {
        const end = src.indexOf('?>', i);
        if (end < 0) fail('Unclosed XML processing instruction');
        i = end + 2;
        continue;
      }
      if (startsWith('<!DOCTYPE') || startsWith('<!doctype')) fail('DTD declarations are not supported');
      if (src[i] === '<') {
        children.push(parseElement());
        continue;
      }
      if (src[i] === '&') {
        text += parseEntity();
        continue;
      }
      text += src[i++];
    }
    fail(`Unclosed element ${name}`);
  }

  skipMisc();
  if (eof()) throw new Error('XML document is empty.');
  const root = parseElement();
  skipMisc();
  if (!eof()) fail('Unexpected trailing XML content');
  return root;
}

export function elementToValue(node: ParsedElement): XmlValue {
  const text = node.text.trim();
  const hasAttr = Object.keys(node.attributes).length > 0;
  if (!node.children.length && !hasAttr) return text;

  const grouped = new Map<string, XmlValue[]>();
  for (const child of node.children) {
    const list = grouped.get(child.name) ?? [];
    list.push(elementToValue(child));
    grouped.set(child.name, list);
  }
  const obj: XmlObject = {};
  for (const [key, values] of grouped) {
    obj[key] = values.length === 1 ? values[0] : values;
  }
  if (text) obj['#text'] = text;
  if (hasAttr) {
    const attrs: XmlObject = {};
    for (const [key, value] of Object.entries(node.attributes)) attrs[key] = value;
    obj['@attributes'] = attrs;
  }
  return obj;
}
