import each from 'jest-each';
import * as tftv from 'twilio-flex-token-validator';

import { functionValidator, responseWithCors, success } from '../src';
import { setup, teardown } from './twilioGlobals';

const gandalfAnger = 'You shall not pass!';
const gandalffWisdom = 'It Is The Small Things, Everyday Deeds Of Ordinary Folk That Keeps The Darkness At Bay. Simple Acts Of Love And Kindness.';

jest.mock('twilio-flex-token-validator', () => ({
  __esModule: true,
  ...jest.requireActual('twilio-flex-token-validator'),
  validator: async () => { throw new Error(gandalfAnger) },
}));

beforeAll(() => {
  setup();
});

afterAll(() => {
  teardown();
});

describe('functionValidator', () => {
  each([
    {
      description: 'no ACCOUNT_SID',
      expectedStatusCode: 403,
      expectedBody: 'Unauthorized: AccountSid or AuthToken was not provided.',
    },
    {
      description: 'no AUTH_TOKEN',
      context: { ACCOUNT_SID: 'ACCOUNT_SID' },
      expectedStatusCode: 403,
      expectedBody: 'Unauthorized: AccountSid or AuthToken was not provided.',
    },
    {
      description: 'no token is provided',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      expectedStatusCode: 403,
      expectedBody: 'Unauthorized: token was not provided.',
    },
    {
      description: 'token is not valid',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 403,
      expectedBody: gandalfAnger
    },
    {
      description: 'token is valid but not tied to worker and default behavior (no options)',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 403,
      expectedBody: 'Unauthorized: endpoint not open to guest tokens.',
      validatorImplementation: async () => ({ worker_sid: null }),
    },
    {
      description: 'token is valid but is guest and default behavior (no options)',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 403,
      expectedBody: 'Unauthorized: endpoint not open to guest tokens.',
      validatorImplementation: async () => ({ worker_sid: 'WK-worker-sid', roles: ['guest'] }),
    },
    {
      description: 'token is valid, belongs to worker and default behavior (no options)',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 200,
      expectedBody: gandalffWisdom,
      validatorImplementation: async () => ({ worker_sid: 'WK-worker-sid', roles: ['agent'] }),
    },
    {
      description: 'token is valid, is not tied to worker and endpoint allow guests',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 200,
      expectedBody: gandalffWisdom,
      options: { allowGuestToken: true },
      validatorImplementation: async () => ({ worker_sid: 'WK-worker-sid', roles: ['guest'] }),
    },
    {
      description: 'token is valid, is guest and endpoint allow guests',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 200,
      expectedBody: gandalffWisdom,
      options: { allowGuestToken: true },
      validatorImplementation: async () => ({ worker_sid: 'WK-worker-sid', roles: ['guest'] }),
    },
    {
      description: 'token is valid, belongs to worker and endpoint allow guests',
      context: { ACCOUNT_SID: 'ACCOUNT_SID', AUTH_TOKEN: 'AUTH_TOKEN' },
      event: { Token: 'token' },
      expectedStatusCode: 200,
      expectedBody: gandalffWisdom,
      options: { allowGuestToken: true },
      validatorImplementation: async () => ({ worker_sid: 'WK-worker-sid', roles: ['agent'] }),
    },
  ]).test('Should return $expectedStatusCode when $description', async ({ expectedStatusCode, expectedBody, validatorImplementation = null, context = {}, event = {}, options = {} }) => {
    const handlerFn = async (context: any, event: any, callback: any) => {
      const response = responseWithCors();

      success(gandalffWisdom)(callback)(response);
    }
  
    const callback = (err: any, payload: any) => {
      expect(payload.getStatus()).toBe(expectedStatusCode);
      const body = payload.getBody();
      if (body instanceof Error) {
        expect(body.message).toContain(expectedBody);
      } else {
        expect(body).toContain(expectedBody);
      }
    }
  
    if (validatorImplementation) {
      jest.spyOn(tftv, 'validator').mockImplementationOnce(validatorImplementation);
    }

    await functionValidator(handlerFn, options)(context, event, callback);
  })
})