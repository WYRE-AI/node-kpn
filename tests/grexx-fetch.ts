import { afterEach, vi } from 'vitest';

import { defaultGrexxTokenCache, type GrexxConfig, GrexxClient, GrexxTokenCache } from '../src/index.js';

export const TOKEN_URL = 'https://auth.grexx.test/oauth/access_token';
export const BASE_URL = 'https://api.grexx.test/interfaces/acceptatie/example';
export const REALTIME_URL = `${BASE_URL}/realtime`;

export const TOKEN_BODY = {
  access_token: 'test-access-token',
  expires_in: 3599,
  token_type: 'Bearer',
};

export const ZIP_INPUT = {
  portfolio: 'All' as const,
  zipCode: '1012JS',
  houseNumber: 1,
  isRoomNumberKnown: false,
};

export const SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ZipCodeCheckResponse_V5>
  <Status>
    <Code>Success</Code>
  </Status>
  <AvailableSuppliers>
    <AvailableSupplier_V5>
      <Name>KPN</Name>
      <AvailableSpeeds>
        <AvailableSpeed_V4>
          <Availability>Green</Availability>
          <Description>Fiber 1 Gbit</Description>
          <NlsType>Nls1</NlsType>
          <Remarks><string>remark</string></Remarks>
          <Technology>FTTH</Technology>
          <TariffCluster>C1</TariffCluster>
        </AvailableSpeed_V4>
      </AvailableSpeeds>
    </AvailableSupplier_V5>
    <AvailableSupplier_V5>
      <Name>KPNWEAS</Name>
    </AvailableSupplier_V5>
    <AvailableSupplier_V5>
      <Name>Tele2Fiber</Name>
      <ErrorMessage>none</ErrorMessage>
    </AvailableSupplier_V5>
  </AvailableSuppliers>
</ZipCodeCheckResponse_V5>`;

export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  redirect: RequestRedirect | undefined;
  signal: AbortSignal | null;
}

export function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
      redirect: init?.redirect,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function xmlResponse(xml: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(xml, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8', ...headers },
  });
}

export function makeGrexx(overrides: Partial<GrexxConfig> = {}): GrexxClient {
  return new GrexxClient({
    username: 'test-user',
    password: 'test-secret',
    baseUrl: BASE_URL,
    tokenUrl: TOKEN_URL,
    maxRetries: 0,
    tokenCache: new GrexxTokenCache(),
    ...overrides,
  });
}

export function realtimeCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url === REALTIME_URL);
}

export function tokenCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url === TOKEN_URL);
}

afterEach(() => {
  vi.unstubAllGlobals();
  defaultGrexxTokenCache.clear();
});
