import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as adjustChatCapacity, Body } from '../functions/adjustChatCapacity';

import helpers, { MockedResponse } from './helpers';

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
  attributes: JSON.stringify({ maxMessageCapacity: 2 }),
  fetch: async () => someWorker,
  workerChannels: () => ({
    list: async () => [workerChannel],
    fetch: async () => workerChannel,
  }),
};

const withoutChannel = {
  attributes: JSON.stringify({ maxMessageCapacity: 2 }),
  fetch: async () => withoutChannel,
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

          throw new Error('Non existing worker');
        },
      }),
    },
  }),
  DOMAIN_NAME: 'serverless',
};

describe('populateCounselors', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const workerSid = 'worker123';
    // const adjustment = 'increase';
    const event1 = {};
    const event2 = { ...event1, workerSid };

    const events = [event1, event2];

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(events.map(e => adjustChatCapacity(baseContext, e, callback)));
  });

  test('Should return status 500', async () => {
    const event: Body = {
      workerSid: 'non-existing',
      adjustment: 'increase',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Non existing worker');
    };

    await adjustChatCapacity(baseContext, event, callback);
  });

  test('Should return status 200 (increase)', async () => {
    const event: Body = {
      workerSid: 'worker123',
      adjustment: 'increase',
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
});
