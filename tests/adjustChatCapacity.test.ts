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
import { handler as adjustChatCapacity, Body } from '../functions/adjustChatCapacity';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const runTestSuite = (maxMessageCapacity: number | string) => {
  let workerChannel = {
    taskChannelUniqueName: 'chat',
    configuredCapacity: 1,
    availableCapacityPercentage: 0,
    updateCapacityPercentage: (availableCapacityPercentage: number) => {
      workerChannel = { ...workerChannel, availableCapacityPercentage };
    },
    update: async ({ capacity }: { capacity: number }) => {
      if (capacity) workerChannel = { ...workerChannel, configuredCapacity: capacity };
    },
  };

  const someWorker = {
    attributes: JSON.stringify({ maxMessageCapacity }),
    fetch: async () => someWorker,
    workerChannels: () => ({
      list: async () => [workerChannel],
      fetch: async () => workerChannel,
    }),
  };

  const withoutChannel = {
    attributes: JSON.stringify({ maxMessageCapacity }),
    fetch: async () => withoutChannel,
    workerChannels: () => ({
      list: async () => [],
    }),
  };

  const withoutAttr = {
    attributes: JSON.stringify({}),
    fetch: async () => withoutAttr,
    workerChannels: () => ({
      list: async () => [],
    }),
  };

  const baseContext = {
    getTwilioClient: (): any => ({
      taskrouter: {
        workspaces: () => ({
          workers: (workerSid: string) => {
            if (workerSid === 'worker123') return someWorker;

            if (workerSid === 'nonExisting') return { fetch: async () => null };

            if (workerSid === 'withoutChannel') return withoutChannel;

            if (workerSid === 'withoutAttr') return withoutAttr;

            throw new Error('Non existing worker');
          },
        }),
      },
    }),
    DOMAIN_NAME: 'serverless',
    PATH: 'PATH',
    SERVICE_SID: undefined,
    ENVIRONMENT_SID: undefined,
    TWILIO_WORKSPACE_SID: 'TWILIO_WORKSPACE_SID',
  };

  describe('adjustChatCapacity', () => {
    beforeAll(() => {
      helpers.setup({});
    });
    afterAll(() => {
      helpers.teardown();
    });

    test('Should return status 400', async () => {
      const workerSid = 'worker123';
      // const adjustment = 'increase';
      const event1 = { request: { cookies: {}, headers: {} } };
      const event2 = { ...event1, workerSid };

      const events = [event1, event2];

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(400);
      };

      await Promise.all(events.map((e) => adjustChatCapacity(baseContext, e, callback)));
    });

    test('Should return status 500', async () => {
      const event: Body = {
        workerSid: 'non-existing',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(500);
        expect(response.getBody().message).toContain('Non existing worker');
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 200 (increase)', async () => {
      const event: Body = {
        workerSid: 'worker123',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(workerChannel.configuredCapacity).toStrictEqual(2);
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 200 (effectively decrease)', async () => {
      // workerChannel.configuredCapacity should already be 2 cause previous test
      expect(workerChannel.configuredCapacity).toStrictEqual(2);

      const event: Body = {
        workerSid: 'worker123',
        adjustment: 'decrease',
        request: { cookies: {}, headers: {} },
      };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(workerChannel.configuredCapacity).toStrictEqual(1);
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 200 (do nothing instead of decrease)', async () => {
      // workerChannel.configuredCapacity should already be 1 cause previous test
      expect(workerChannel.configuredCapacity).toStrictEqual(1);

      const event: Body = {
        workerSid: 'worker123',
        adjustment: 'decrease',
        request: { cookies: {}, headers: {} },
      };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(workerChannel.configuredCapacity).toStrictEqual(1);
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 412 (Still have available capacity, no need to increase)', async () => {
      workerChannel.updateCapacityPercentage(1);
      expect(workerChannel.availableCapacityPercentage).toStrictEqual(1);

      const event: Body = {
        workerSid: 'worker123',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(412);
        expect(response.getBody().message).toContain(
          'Still have available capacity, no need to increase',
        );
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 412 (Reached the max capacity)', async () => {
      workerChannel.updateCapacityPercentage(0);
      expect(workerChannel.availableCapacityPercentage).toStrictEqual(0);

      const event: Body = {
        workerSid: 'worker123',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      await adjustChatCapacity(baseContext, event, () => {});
      expect(workerChannel.configuredCapacity).toStrictEqual(2);

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(412);
        expect(response.getBody().message).toContain('Reached the max capacity');
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 404 (Could not find worker)', async () => {
      workerChannel.updateCapacityPercentage(0);
      expect(workerChannel.availableCapacityPercentage).toStrictEqual(0);

      const event: Body = {
        workerSid: 'nonExisting',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      await adjustChatCapacity(baseContext, event, () => {});

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(404);
        expect(response.getBody().message).toContain('Could not find worker');
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 404 (Could not find chat channel)', async () => {
      workerChannel.updateCapacityPercentage(0);

      const event: Body = {
        workerSid: 'withoutChannel',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      await adjustChatCapacity(baseContext, event, () => {});
      expect(workerChannel.configuredCapacity).toStrictEqual(2);

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(404);
        expect(response.getBody().message).toContain('Could not find chat channel');
      };

      await adjustChatCapacity(baseContext, event, callback);
    });

    test('Should return status 409 (Worker does not have a "maxMessageCapacity" attribute, can\'t adjust capacity.)', async () => {
      const event: Body = {
        workerSid: 'withoutAttr',
        adjustment: 'increase',
        request: { cookies: {}, headers: {} },
      };

      await adjustChatCapacity(baseContext, event, () => {});
      expect(workerChannel.configuredCapacity).toStrictEqual(2);

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(409);
        expect(response.getBody().message).toContain(
          `Worker ${event.workerSid} does not have a "maxMessageCapacity" attribute, can't adjust capacity.`,
        );
      };

      await adjustChatCapacity(baseContext, event, callback);
    });
  });
};

runTestSuite(2);
runTestSuite('2');
