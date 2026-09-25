import type {
  AvailabilityResult,
  Disturbance,
  DisturbanceResult,
  SimSwapResult,
} from '../../src/index.js';

// Fictional addresses and numbers only.
export const address = { zipCode: '1234AB', houseNumber: 10, houseNumberExtension: 'A' };

export const disturbanceFixture: Disturbance = {
  id: 900001,
  type: 'generic',
  cause: 'disturbance',
  source: 'gui',
  service: 'Internet',
  state: 'open',
  start_date: '2026-09-25T08:00:00+02:00',
  end_date: '2026-09-25T14:00:00+02:00',
  region: 'Voorbeeldstad',
  description: 'Storing internet',
  long_description: '<p>Er is een storing in de regio.</p>',
  affected_elements_count: 3,
  affected_customers_count: 120,
  serviceguard_ticket_id: 'SG-0000001',
  created_at: '2026-09-25T08:05:00+02:00',
  communication_type: 'sms',
};

export const disturbanceResultFixture: DisturbanceResult = {
  broadband: [disturbanceFixture],
  fixed: [],
  mobile: [],
  generic: [],
};

/** OAS shape: `bandwidth`, and `alerts` as an (empty) object for a valid address. */
export const availabilityWireFixture = {
  available_on_address: {
    technologies: [
      { name: 'FIBER', download: 1000, upload: 1000 },
      { name: 'COPPER', download: 16, upload: 2 },
    ],
    house_number_extensions: ['A', 'B'],
  },
  fixed_info: { copper_access: true, fiber_access: true, hybrid_access: false, mobile_access: true },
  fiber_info: {
    thirdparty_delivery: false,
    thirdparty_permission: false,
    construction_type: 'FTTH',
    planned_fiber_to_the_home_date: '2027-01-01',
    nl_type: 'NL1',
    phase: 'Opgeleverd',
  },
  bandwidth: { up: 1000, down: 1000 },
  alerts: {},
};

export const availabilityResultFixture: AvailabilityResult = {
  ...availabilityWireFixture,
  alerts: [],
};

/** Docs shape: `max_bandwidth`, and `alerts` as a populated object (unknown address). */
export const availabilityDocsWireFixture = {
  max_bandwidth: { up: 2, down: 16 },
  alerts: { code: '10', description: 'Address not found', code_message: 'ADDRESS_NOT_FOUND' },
};

export const simSwapFixture: SimSwapResult = {
  latestSimChange: '2026-09-01T14:27:08.312+02:00',
};

/** CAMARA error envelope for a number that is not on the KPN network. */
export const unknownPhoneNumberBody = {
  status: 404,
  code: 'SIM_SWAP.UNKNOWN_PHONE_NUMBER',
  message: 'Unknown phone number',
};
