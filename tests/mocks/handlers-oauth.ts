import { http, HttpResponse } from 'msw';

import { gatewayTokenBody, invalidClientBody, msmTokenBody } from '../fixtures/oauth.js';

const BASE = 'https://api-prd.kpn.com';

/**
 * Both Apigee token endpoints. Enforces the real request shape: grant_type in
 * the query string, form-encoded client_id/client_secret, no Basic auth.
 */
function tokenHandler(path: string, body: Record<string, string>) {
  return http.post(`${BASE}${path}`, async ({ request }) => {
    const url = new URL(request.url);
    const form = new URLSearchParams(await request.text());
    if (
      url.searchParams.get('grant_type') !== 'client_credentials' ||
      !form.get('client_id') ||
      !form.get('client_secret') ||
      request.headers.has('authorization')
    ) {
      return HttpResponse.json(invalidClientBody, { status: 401 });
    }
    return HttpResponse.json(body);
  });
}

export const oauthHandlers = [
  tokenHandler('/oauth/client_credential/accesstoken', gatewayTokenBody),
  tokenHandler('/oauth/grip/msm/accesstoken', msmTokenBody),
];
