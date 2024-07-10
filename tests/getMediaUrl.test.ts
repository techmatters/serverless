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
// import axios from 'axios';
import { handler as getMediaUrl, Event } from '../functions/getMediaUrl';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ test: 100 }),
  }),
) as jest.Mock;

// const fetchMock = jest
//   .fn()
//   .mockImplementation(() => Promise.resolve({ json: () => Promise.resolve([]) })) as jest.Mock;

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

  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  test('Should return status 400 if value is serviceSid or mediaSid undefined', async () => {
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

  test('Should return status 500 if header is not defined', async () => {
    const event: Event = {
      serviceSid: 'ISxxxxxxxxxxxxxxAWX',
      mediaSid: 'MIxxxxxxxxxxIOL',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Headers is not defined');
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

  //   test('Should override default authorization headers with environment variables in GET request', async () => {
  //     const event: Event = {
  //       serviceSid: 'ISxxxxxxxxxxxxxxAWX',
  //       mediaSid: 'MIxxxxxxxxxxIOL',
  //       request: { cookies: {}, headers: {} },
  //     };
  //     // const url = `https://mcs.us1.twilio.com/v1/Services/${event.serviceSid}/Media/${event.mediaSid}`;
  //     // const username = 'testUser';
  //     // const password = 'testPass';

  //     const consoleSpy = jest.spyOn(console, 'log');

  //     await getMediaUrl(baseContext, event, () => {});

  //     // expect(fetch).toHaveBeenCalledTimes(1);
  //     expect(fetchMock).toHaveBeenCalledWith(
  //       'https://mcs.us1.twilio.com/v1/Services/ISxxxxxxx/Media/Mxxxxxxx',
  //       expect.objectContaining({
  //         method: 'GET',
  //         // headers: expect.any(Headers),
  //       }),
  //     );

  //     // expect(fetchMock).toHaveBeenCalledWith(
  //     //   url,
  //     //   expect.objectContaining({
  //     //     method: 'GET',
  //     //     headers: {
  //     //       Authorization: `Basic ${btoa(`${username}:${password}`)}`,
  //     //     },
  //     //   }),
  //     // );

  //     expect(consoleSpy).toHaveBeenCalledWith({ message: 'Success' });

  //     // Check the function separately
  //     // const actualArgs = mockFetch.mock.calls[0][0];
  //     // expect(actualArgs.validateStatus).toBeInstanceOf(Function);
  //   });
});
