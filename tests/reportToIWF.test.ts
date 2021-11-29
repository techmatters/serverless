import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import { handler as reportToIWF, Event as Body } from '../functions/reportToIWF';

import helpers, { MockedResponse } from './helpers';

jest.mock('axios');

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  IWF_API_USERNAME: 'IWF_API_USERNAME',
  IWF_API_PASSWORD: 'IWF_API_PASSWORD',
  IWF_API_URL: 'IWF_API_URL',
};

describe('reportToIWF', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should return status 400', async () => {
    const event1: Body = { Reported_URL: undefined, Reporter_Anonymous: 'Y' };
    const event2: Body = { Reported_URL: 'Reported_URL', Reporter_Anonymous: undefined };
    const event3: Body = { Reported_URL: 'Reported_URL', Reporter_Anonymous: 'Other' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await reportToIWF(baseContext, event1, callback);
    await reportToIWF(baseContext, event2, callback);
    await reportToIWF(baseContext, event3, callback);
  });

  test('Should return status 500', async () => {
    jest.spyOn(Buffer, 'from').mockImplementationOnce(() => {
      throw new Error('Boom!');
    });

    const event: Body = { Reported_URL: 'Reported_URL', Reporter_Anonymous: 'Y' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Boom!');
    };

    await reportToIWF(baseContext, event, callback);
  });

  test('Should return status 200', async () => {
    // @ts-ignore
    axios.mockImplementationOnce(() =>
      Promise.resolve({
        status: 200,
        data: 'Returned ok',
      }),
    );

    const event: Body = { Reported_URL: 'Reported_URL', Reporter_Anonymous: 'Y' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody().toString()).toContain('Returned ok');
    };

    await reportToIWF(baseContext, event, callback);
  });

  test('Should return error code if axios call fails (redirect IWF payload)', async () => {
    // @ts-ignore
    axios.mockImplementationOnce(() =>
      Promise.resolve({
        status: 403,
        data: 'Unauthorized',
      }),
    );

    const event: Body = { Reported_URL: 'Reported_URL', Reporter_Anonymous: 'Y' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().toString()).toContain('Unauthorized');
    };

    await reportToIWF(baseContext, event, callback);
  });
});
