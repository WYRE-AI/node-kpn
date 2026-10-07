import { describeGrexxCode, orderStatusCodeFromLabel } from './codes.js';
import { GrexxError } from './errors.js';
import { elementToValue, parseXmlDocument, type ParsedElement, type XmlObject, type XmlValue } from './xml.js';

export interface GrexxOrderStatus {
  code: number;
  /** Short label: `Active`, `Accepted`, `Order Modified`, … */
  meaning: string;
  detail?: string;
}

export interface GrexxParsedResponse {
  rootElement: string;
  /**
   * Gateway code when a code element carried 0, 68 or 100–109.
   * `0` is success and is returned, not thrown, by the client.
   */
  grexxCode?: number;
  /** Mapped label for {@link grexxCode}. */
  grexxCodeMessage?: string;
  /** Message text from the body, when an element such as `Message` or `ErrorDescription` was present. */
  message?: string;
  /** IRMA order lifecycle status (201, 203, 204, …) when present. Not a gateway failure. */
  orderStatus?: GrexxOrderStatus;
  /** Other numeric RoutIT code (1…100000) that is neither a gateway code nor an order status. */
  routitCode?: number;
  body: XmlObject;
  rawXml: string;
}

const CODE_NAMES = new Set(['code', 'errorcode', 'resultcode', 'statuscode', 'responsecode', 'grexxcode']);
const STATUS_NAMES = new Set(['status', 'orderstatus', 'orderstatuscode']);
const MESSAGE_PRIORITY: Record<string, number> = {
  errormessage: 0,
  resultmessage: 1,
  errordescription: 2,
  statusmessage: 3,
  resultdescription: 4,
  message: 5,
  description: 6,
};

interface CodeHit {
  depth: number;
  value: number;
}

interface MessageHit {
  depth: number;
  priority: number;
  text: string;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

function consider(node: ParsedElement, depth: number, state: {
  grexx?: CodeHit;
  order?: CodeHit;
  routit?: CodeHit;
  message?: MessageHit;
}): void {
  const text = node.text.trim();
  const leaf = node.children.length === 0;
  const lname = localName(node.name);

  if (leaf && text) {
    const priority = MESSAGE_PRIORITY[lname];
    if (priority !== undefined) {
      const better =
        state.message === undefined ||
        priority < state.message.priority ||
        (priority === state.message.priority && depth < state.message.depth);
      if (better) state.message = { depth, priority, text };
    }

    if (/^-?\d+$/.test(text)) {
      const value = Number(text);
      const info = describeGrexxCode(value);
      const hit: CodeHit = { depth, value };
      const isCode = CODE_NAMES.has(lname);
      const isStatus = STATUS_NAMES.has(lname);
      if ((isCode || isStatus) && (info.category === 'success' || info.category === 'gateway')) {
        if (state.grexx === undefined || depth < state.grexx.depth) state.grexx = hit;
      } else if ((isCode || isStatus) && info.category === 'order') {
        if (state.order === undefined || depth < state.order.depth) state.order = hit;
      } else if (isCode && (info.category === 'routit' || info.category === 'unknown')) {
        if (state.routit === undefined || depth < state.routit.depth) state.routit = hit;
      }
    } else if (STATUS_NAMES.has(lname)) {
      const fromLabel = orderStatusCodeFromLabel(text);
      if (fromLabel !== undefined && (state.order === undefined || depth < state.order.depth)) {
        state.order = { depth, value: fromLabel };
      }
    }
  }

  for (const child of node.children) consider(child, depth + 1, state);
}

function asObject(value: XmlValue): XmlObject {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value !== '') return { '#text': value };
  return {};
}

/** Parse a Grexx/IRMA XML response and map gateway plus order-status codes. Does not throw on those codes. */
export function parseGrexxResponse(xml: string): GrexxParsedResponse {
  const root = parseXmlDocument(xml);
  const state: { grexx?: CodeHit; order?: CodeHit; routit?: CodeHit; message?: MessageHit } = {};
  consider(root, 0, state);

  const grexxCode = state.grexx?.value;
  const grexxInfo = grexxCode !== undefined ? describeGrexxCode(grexxCode) : undefined;
  const orderInfo = state.order !== undefined ? describeGrexxCode(state.order.value) : undefined;

  return {
    rootElement: root.name,
    grexxCode,
    grexxCodeMessage: grexxInfo?.message,
    message: state.message?.text,
    orderStatus:
      state.order !== undefined && orderInfo?.category === 'order'
        ? { code: state.order.value, meaning: orderInfo.message, detail: orderInfo.detail }
        : undefined,
    routitCode: state.routit?.value,
    body: asObject(elementToValue(root)),
    rawXml: xml,
  };
}

const GATEWAY_ROOTS = new Set(['error', 'response', 'webserviceresponse', 'result', 'fault']);

function rootMatches(rootElement: string, family: string): boolean {
  const root = localName(rootElement);
  const expected = family.toLowerCase();
  return root === expected || root.startsWith(`${expected}response`) || root.startsWith(`${expected}_`);
}

/**
 * Parse `xml` and require a response root in `families` (for example `ZipCodeCheck`).
 * Gateway error envelopes (`Error`, `Response`, …) and bodies that already carry a
 * gateway code are accepted so callers can inspect code 109 without a second parser.
 */
export function parseTypedResponse(xml: string, families: readonly string[]): GrexxParsedResponse {
  const parsed = parseGrexxResponse(xml);
  if (families.some((family) => rootMatches(parsed.rootElement, family))) return parsed;
  if (GATEWAY_ROOTS.has(localName(parsed.rootElement))) return parsed;
  if (parsed.grexxCode !== undefined && describeGrexxCode(parsed.grexxCode).category === 'gateway') {
    return parsed;
  }
  throw new GrexxError(`Expected <${families[0]}> response XML, received <${parsed.rootElement}>.`, {
    grexxCode: parsed.grexxCode,
    responseXml: xml,
    parsed,
  });
}
