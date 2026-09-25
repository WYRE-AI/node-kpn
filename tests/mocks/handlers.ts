import { mobileOrderHandlers } from './handlers-mobile-orders.js';
import { mobileOrgHandlers } from './handlers-mobile-org.js';
import { networkHandlers } from './handlers-network.js';
import { oauthHandlers } from './handlers-oauth.js';

// Token endpoints first; each domain owns its own handler module.
export const handlers = [
  ...oauthHandlers,
  ...networkHandlers,
  ...mobileOrgHandlers,
  ...mobileOrderHandlers,
];
