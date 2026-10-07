import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GREXX_TOKEN_URL,
  GrexxClient,
  GrexxConfigError,
  grexxConfigFromEnv,
  resolveGrexxConfig,
} from '../src/index.js';
import { BASE_URL, REALTIME_URL, SUCCESS_XML, TOKEN_BODY, TOKEN_URL, installFetch, jsonResponse, xmlResponse } from './grexx-fetch.js';

const ENV = {
  KPN_GREXX_USERNAME: 'env-user',
  KPN_GREXX_PASSWORD: 'env-secret',
  KPN_GREXX_BASE_URL: BASE_URL,
};

describe('Grexx env and gateway headers', () => {
  it('reads credentials and base URL from the environment and defaults the token URL', () => {
    expect(grexxConfigFromEnv(ENV)).toEqual({
      username: 'env-user',
      password: 'env-secret',
      baseUrl: BASE_URL,
      tokenUrl: DEFAULT_GREXX_TOKEN_URL,
    });
    expect(DEFAULT_GREXX_TOKEN_URL).toBe('https://service-accept.grexx.today/oauth/access_token');
    expect(grexxConfigFromEnv({ ...ENV, KPN_GREXX_TOKEN_URL: TOKEN_URL }).tokenUrl).toBe(TOKEN_URL);
  });

  it('requires the base URL and both credentials', () => {
    expect(() => grexxConfigFromEnv({ ...ENV, KPN_GREXX_BASE_URL: '  ' })).toThrow(/KPN_GREXX_BASE_URL/);
    expect(() => grexxConfigFromEnv({ ...ENV, KPN_GREXX_USERNAME: '' })).toThrow(GrexxConfigError);
    expect(() => grexxConfigFromEnv({ ...ENV, KPN_GREXX_BASE_URL: 'http://insecure.example/irma' })).toThrow(/https/);
    expect(() =>
      grexxConfigFromEnv({ ...ENV, KPN_GREXX_TOKEN_URL: 'https://user:secret@auth.example/token' }),
    ).toThrow(/credentials/);
  });

  it('takes username and password from gateway headers and URLs from the environment only', async () => {
    const headers = new Headers({
      'X-KPN-Grexx-Username': 'header-user',
      'X-KPN-Grexx-Password': 'header-secret',
    });
    const config = resolveGrexxConfig({ env: { ...ENV, KPN_GREXX_TOKEN_URL: TOKEN_URL }, headers });
    expect(config.username).toBe('header-user');
    expect(config.password).toBe('header-secret');
    expect(config.baseUrl).toBe(BASE_URL);
    expect(config.tokenUrl).toBe(TOKEN_URL);

    const calls = installFetch((call) => (call.url === TOKEN_URL ? jsonResponse(TOKEN_BODY) : xmlResponse(SUCCESS_XML)));
    await GrexxClient.fromEnv({ env: { ...ENV, KPN_GREXX_TOKEN_URL: TOKEN_URL }, headers }).zipCodeCheck({
      portfolio: 'All',
      zipCode: '1012JS',
      houseNumber: 1,
      isRoomNumberKnown: false,
    });
    const token = calls.find((call) => call.url === TOKEN_URL)!;
    expect(new URLSearchParams(token.body).get('client_id')).toBe('header-user');
    expect(new URLSearchParams(token.body).get('client_secret')).toBe('header-secret');
    expect(calls.find((call) => call.url === REALTIME_URL)?.url).toBe(REALTIME_URL);
  });

  it('rejects base URL and token URL headers without copying their values into the error', () => {
    const stolen = 'https://evil.example/collect';
    expect(() =>
      resolveGrexxConfig({
        env: ENV,
        headers: {
          'X-KPN-Grexx-Username': 'header-user',
          'X-KPN-Grexx-Password': 'header-secret',
          'X-KPN-Grexx-Base-Url': stolen,
        },
      }),
    ).toThrow(GrexxConfigError);
    try {
      resolveGrexxConfig({
        env: ENV,
        headers: { 'X-KPN-Grexx-Token-Url': stolen },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GrexxConfigError);
      expect((err as Error).message).not.toContain('evil.example');
      expect((err as Error).message).toContain('x-kpn-grexx-token-url');
    }
    expect(() => resolveGrexxConfig({ env: ENV, headers: { 'X-KPN-Base-Url': stolen } })).toThrow(/environment only/);
  });

  it('requires gateway credential headers to be paired', () => {
    expect(() => resolveGrexxConfig({ env: ENV, headers: { 'X-KPN-Grexx-Username': 'only-user' } })).toThrow(
      /together/,
    );
  });
});
