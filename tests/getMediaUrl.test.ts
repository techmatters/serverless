/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
// import { omit } from 'lodash';
import { handler as getMediaUrl, Event } from '../functions/getMediaUrl';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

jest.mock('axios', () => ({
  request: jest.fn(),
}));

const mockAxiosRequest = axios.request as jest.MockedFunction<typeof axios.request>;

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  AUTH_TOKEN: 'AUTH_TOKEN',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

// const defaultPayload = {
//   serviceSid: 'ISxxxxxxxxxxxxxxAWX',
//   mediaSid: 'MIxxxxxxxxxxIOL',
// };

describe('getMediaUrl', () => {
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

  test('Should return status 400 if value is undefined', async () => {
    const event1: Event = {
      serviceSid: undefined,
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    const emptyEvent = {
      mediaSid: undefined,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await getMediaUrl(baseContext, event1, callback);
    await getMediaUrl(baseContext, emptyEvent, callback);
  });

  test('Should return status 500 if data is undefined', async () => {
    const event: Event = {
      serviceSid: 'ISxxxxxxxxxxxxxxAWX',
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('undefined');
    };

    await getMediaUrl(baseContext, event, callback);
  });

  test('Should GET a payload from twilio media and return 200', async () => {
    const event: Event = {
      serviceSid: 'ISxxxxxxxxxxxxxxAWX',
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    const callback = jest.fn();

    await getMediaUrl(baseContext, event, callback);

    expect(callback.mock.results).toHaveLength(1);
    expect(callback.mock.results[0].type).toBe('return');

    const result = callback.mock.lastCall[1];
    expect(result).toBeDefined();
  });

  test('Should override default authorization headers with environment variables in GET request', async () => {
    const event: Event = {
      serviceSid: 'ISxxxxxxxxxxxxxxAWX',
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    await getMediaUrl(baseContext, event, () => {});

    expect(mockAxiosRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: 'Basic QUNDT1VOVF9TSUQ6QVVUSF9UT0tFTg==' },
        method: 'get',
        url: `https://mcs.us1.twilio.com/v1/Services/${event.serviceSid}/Media/${event.mediaSid}`,
      }),
    );

    // Check the function separately
    const actualArgs = mockAxiosRequest.mock.calls[0][0];
    expect(actualArgs.validateStatus).toBeInstanceOf(Function);
  });
});
