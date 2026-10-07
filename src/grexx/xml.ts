import { GrexxError, GrexxValidationError } from './errors.js';

/** Child value accepted by the XML builder. Arrays repeat the parent element name. */
export type XmlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | XmlValue[]
  | { [key: string]: XmlValue };

export type XmlNode = string | null | XmlObject | XmlNode[];

export interface XmlObject {
  [key: string]: XmlNode;
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function assertXmlName(name: string): void {
  if (!XML_NAME.test(name)) {
    throw new GrexxValidationError(`Invalid XML name "${name}"`, 0, undefined, 'invalid_xml_name');
  }
}

export function escapeXml(text: string): string {
  if (ILLEGAL_XML_CHARS.test(text)) {
    throw new GrexxValidationError('XML text contains illegal control characters', 0, undefined, 'invalid_xml_text');
  }
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderValue(name: string, value: XmlValue): string {
  assertXmlName(name);
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => renderValue(name, item)).join('');
  if (typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([key, child]) => renderValue(key, child))
      .join('');
    return `<${name}>${inner}</${name}>`;
  }
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  return `<${name}>${escapeXml(text)}</${name}>`;
}

/** Serialize a document. Object keys become child elements in insertion order. */
export function buildXmlDocument(rootElement: string, body: Record<string, XmlValue>): string {
  assertXmlName(rootElement);
  const inner = Object.entries(body)
    .map(([key, value]) => renderValue(key, value))
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><${rootElement}>${inner}</${rootElement}>`;
}

function stripXmlDeclaration(xml: string): string {
  return xml.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\b[^?]*\?>\s*/i, '');
}

/**
 * Build the `/realtime` body. A string whose first element is `rootElement`
 * is sent as that document; any other string is wrapped in `rootElement`.
 * Object bodies are serialized. DTD / entity declarations are rejected.
 */
export function renderRealtimeBody(rootElement: string, body: string | Record<string, XmlValue>): string {
  assertXmlName(rootElement);
  if (typeof body !== 'string') return buildXmlDocument(rootElement, body);

  const stripped = stripXmlDeclaration(body).trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(stripped)) {
    throw new GrexxValidationError('XML DTD and entity declarations are not allowed', 0, undefined, 'dtd_not_allowed');
  }
  const root = /^<([A-Za-z_][A-Za-z0-9_.-]*)\b/.exec(stripped);
  if (root?.[1] === rootElement) {
    return `<?xml version="1.0" encoding="utf-8"?>${stripped}`;
  }
  return `<?xml version="1.0" encoding="utf-8"?><${rootElement}>${stripped}</${rootElement}>`;
}

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

class XmlParser {
  private i = 0;

  constructor(private readonly source: string) {}

  parse(): XmlElement {
    this.skipMisc();
    const element = this.parseElement();
    this.skipMisc();
    if (this.i < this.source.length) {
      throw this.fail('Unexpected trailing content after the root element');
    }
    return element;
  }

  private parseElement(): XmlElement {
    this.expect('<');
    if (this.source.startsWith('!', this.i) || this.source.startsWith('?', this.i)) {
      throw this.fail('DTD, comments, and processing instructions are not allowed inside elements');
    }
    const name = this.readName();
    const attributes = this.readAttributes();
    this.skipSpaces();
    if (this.source.startsWith('/>', this.i)) {
      this.i += 2;
      return { name, attributes, children: [], text: '' };
    }
    this.expect('>');
    const children: XmlElement[] = [];
    let text = '';
    while (this.i < this.source.length) {
      if (this.source.startsWith('</', this.i)) {
        this.i += 2;
        const end = this.readName();
        if (end !== name) throw this.fail(`End tag </${end}> does not match <${name}>`);
        this.skipSpaces();
        this.expect('>');
        return { name, attributes, children, text };
      }
      if (this.source.startsWith('<!--', this.i)) {
        this.skipComment();
        continue;
      }
      if (this.source.startsWith('<![CDATA[', this.i)) {
        text += this.readCdata();
        continue;
      }
      if (this.source.startsWith('<!', this.i)) {
        throw this.fail('DTD declarations are not allowed');
      }
      if (this.source.startsWith('<', this.i)) {
        children.push(this.parseElement());
        continue;
      }
      text += this.readText();
    }
    throw this.fail(`Unclosed element <${name}>`);
  }

  private readAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (;;) {
      this.skipSpaces();
      if (this.source.startsWith('>', this.i) || this.source.startsWith('/>', this.i) || this.i >= this.source.length) {
        return attributes;
      }
      const rawName = this.readName();
      this.skipSpaces();
      this.expect('=');
      this.skipSpaces();
      const quote = this.source[this.i];
      if (quote !== '"' && quote !== "'") throw this.fail('Attribute value must be quoted');
      this.i += 1;
      const start = this.i;
      const end = this.source.indexOf(quote, this.i);
      if (end === -1) throw this.fail('Unterminated attribute value');
      this.i = end + 1;
      const local = localName(rawName);
      attributes[local] = decodeEntities(this.source.slice(start, end));
    }
  }

  private readName(): string {
    const start = this.i;
    if (!/[A-Za-z_:]/.test(this.source[this.i] ?? '')) throw this.fail('Expected an XML name');
    this.i += 1;
    while (this.i < this.source.length && /[A-Za-z0-9_.:-]/.test(this.source[this.i] ?? '')) this.i += 1;
    return localName(this.source.slice(start, this.i));
  }

  private readText(): string {
    const start = this.i;
    const next = this.source.indexOf('<', this.i);
    if (next === -1) {
      this.i = this.source.length;
      return decodeEntities(this.source.slice(start));
    }
    this.i = next;
    return decodeEntities(this.source.slice(start, next));
  }

  private readCdata(): string {
    const start = this.i + '<![CDATA['.length;
    const end = this.source.indexOf(']]>', start);
    if (end === -1) throw this.fail('Unterminated CDATA section');
    this.i = end + 3;
    return this.source.slice(start, end);
  }

  private skipComment(): void {
    const end = this.source.indexOf('-->', this.i + 4);
    if (end === -1) throw this.fail('Unterminated comment');
    this.i = end + 3;
  }

  private skipMisc(): void {
    for (;;) {
      this.skipSpaces();
      if (this.source.startsWith('<?', this.i)) {
        const end = this.source.indexOf('?>', this.i + 2);
        if (end === -1) throw this.fail('Unterminated processing instruction');
        this.i = end + 2;
        continue;
      }
      if (this.source.startsWith('<!--', this.i)) {
        this.skipComment();
        continue;
      }
      if (this.source.startsWith('<!DOCTYPE', this.i) || this.source.startsWith('<!ENTITY', this.i)) {
        throw this.fail('DTD and entity declarations are not allowed');
      }
      return;
    }
  }

  private skipSpaces(): void {
    while (this.i < this.source.length && /\s/.test(this.source[this.i] ?? '')) this.i += 1;
  }

  private expect(token: string): void {
    if (!this.source.startsWith(token, this.i)) throw this.fail(`Expected "${token}"`);
    this.i += token.length;
  }

  private fail(message: string): GrexxError {
    return new GrexxError(`${message} at offset ${this.i}`, 0, undefined, 'invalid_xml');
  }
}

function characterReference(digits: string, radix: number): string {
  if (!/^[0-9A-Fa-f]+$/.test(digits)) {
    throw new GrexxError('Invalid XML character reference', 0, undefined, 'invalid_xml');
  }
  const codePoint = parseInt(digits, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    throw new GrexxError('Invalid XML character reference', 0, undefined, 'invalid_xml');
  }
  return String.fromCodePoint(codePoint);
}

function localName(qname: string): string {
  const index = qname.indexOf(':');
  return index === -1 ? qname : qname.slice(index + 1);
}

function decodeEntities(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== '&') {
      out += input[i];
      continue;
    }
    const semi = input.indexOf(';', i + 1);
    if (semi === -1 || semi - i > 32) {
      throw new GrexxError('Invalid XML entity', 0, undefined, 'invalid_xml');
    }
    const entity = input.slice(i + 1, semi);
    if (entity === 'amp') out += '&';
    else if (entity === 'lt') out += '<';
    else if (entity === 'gt') out += '>';
    else if (entity === 'quot') out += '"';
    else if (entity === 'apos') out += "'";
    else if (entity.startsWith('#x') || entity.startsWith('#X')) {
      out += characterReference(entity.slice(2), 16);
    } else if (entity.startsWith('#')) {
      out += characterReference(entity.slice(1), 10);
    } else {
      throw new GrexxError(`Unknown XML entity "&${entity};"`, 0, undefined, 'invalid_xml');
    }
    i = semi;
  }
  return out;
}

function isNil(attributes: Record<string, string>): boolean {
  const nil = attributes['nil'];
  return nil === 'true' || nil === '1';
}

function toNode(element: XmlElement): XmlNode {
  if (isNil(element.attributes)) return null;
  if (element.children.length === 0) return element.text.trim();
  const object: XmlObject = {};
  for (const child of element.children) {
    const value = toNode(child);
    const existing = object[child.name];
    if (existing === undefined) object[child.name] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else object[child.name] = [existing, value];
  }
  return object;
}

/** Parse a Grexx XML document into `{ RootElement: children }`. No DTD expansion. */
export function parseXml(xml: string): XmlObject {
  const trimmed = xml.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new GrexxError('Empty XML document', 0, undefined, 'invalid_xml');
  const element = new XmlParser(trimmed).parse();
  return { [element.name]: toNode(element) };
}
