/** Apigee client-credentials token body: every value is a string (fictional). */
export const gatewayTokenBody = {
  refresh_token_expires_in: '0',
  api_product_list: '[disturbance-check, internet-speed-check, sim-swap]',
  organization_name: 'kpn',
  'developer.email': 'dev@example.test',
  token_type: 'Bearer',
  issued_at: '1587458037687',
  client_id: 'test-client-id',
  access_token: 'fake-gateway-access-token',
  application_name: 'wyre-test-app',
  scope: '',
  expires_in: '3599',
  refresh_count: '0',
  status: 'approved',
  refresh_token: '',
  level: 'demo',
};

export const msmTokenBody = {
  ...gatewayTokenBody,
  client_id: 'test-msm-client-id',
  access_token: 'fake-msm-access-token',
  application_name: 'wyre-test-msm-app',
};

/** Token endpoint's own error envelope. */
export const invalidClientBody = { ErrorCode: 'invalid_client', Error: 'ClientId is Invalid' };

/** Apigee fault for a rejected access token (may arrive on any status). */
export const invalidTokenFault = {
  fault: {
    faultstring: 'Invalid access token',
    detail: { errorcode: 'oauth.v2.InvalidAccessToken' },
  },
};
