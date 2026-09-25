import type { HierarchyItem } from './mobile-hierarchy.js';

/** MSM `Subscriber` (from `GET /hierarchy/subscribers`). */
export interface Subscriber {
  id?: number;
  firstName?: string;
  lastName?: string;
  prefix?: string;
  employeeNumber?: string;
  fixedNumber?: string;
  gripUser?: boolean;
  user?: boolean;
  contracts?: { amount?: number; firstPhoneNumber?: string };
  path?: HierarchyItem[];
}

/** MSM `SubscriberDetails` (from `GET /hierarchy/subscribers/{id}`). Note `surname`, not `lastName`. */
export interface SubscriberDetails {
  id?: number;
  firstName?: string;
  surname?: string;
  surnamePrefix?: string;
  email?: string;
  mobileNumber?: string;
  fixedNumber?: string;
  employeeNumber?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  preferredLanguage?: 'EN' | 'NL';
  vip?: boolean;
  comments?: string;
  location?: string[];
  gripUser?: boolean;
  user?: boolean;
  path?: HierarchyItem[];
}
