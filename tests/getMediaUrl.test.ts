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
// eslint-disable-next-line import/no-extraneous-dependencies
import fetchMock from 'jest-fetch-mock';
import { handler as getMediaUrl, Event } from '../functions/getMediaUrl';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const mockFetchRequest = fetch as jest.MockedFunction<typeof fetch>;

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  AUTH_TOKEN: 'AUTH_TOKEN',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

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

  beforeAll(() => {
    fetchMock.enableMocks();
  });

  // Reset mocks after each test
  afterEach(() => {
    fetchMock.resetMocks();
  });

  test('Should return status 400 if serviceSid or mediaSid  values are undefined', async () => {
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

  test('Should return status 500 if JSON response body is invalid', async () => {
    const event: Event = {
      serviceSid: 'ISxxxxxxxxxxxxxxAWX',
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'invalid json response body at  reason: Unexpected end of JSON input',
      );
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
    const url = `https://mcs.us1.twilio.com/v1/Services/${event.serviceSid}/Media/${event.mediaSid}`;

    await getMediaUrl(baseContext, event, () => {});

    expect(mockFetchRequest).toHaveBeenCalledWith(url, {
      method: 'GET',
      headers: expect.any(Headers),
    });
  });
});
