import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as setTaskInsightsData, Body } from '../functions/setTaskInsightsData';

import helpers, { MockedResponse } from './helpers';

const tasks: any[] = [
  {
    sid: 'task1',
    attributes: '{ "customers": { "customer1": "customer1" } }',
    fetch: async () => tasks.find(t => t.sid === 'task1'),
    update: async ({ attributes }: { attributes: string }) => {
      const task = tasks.find(t => t.sid === 'task1');
      return {
        ...task,
        attributes,
      };
    },
  },
];

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find(t => t.sid === taskSid);
      if (task) return task;

      throw new Error('Task does not exists');
    },
  },
};

const baseContext = {
  getTwilioClient: (): any => ({
    taskrouter: {
      workspaces: (workspaceSID: string) => {
        if (workspaces[workspaceSID]) return workspaces[workspaceSID];

        throw new Error('Workspace does not exists');
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
};

describe('setTaskInsightsData', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const event1: Body = { workspaceSID: undefined, taskSID: 'task1' };
    const event2: Body = { workspaceSID: 'WSxxx', taskSID: undefined };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [{}, event1, event2].map(event => setTaskInsightsData(baseContext, event, callback)),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = { workspaceSID: 'non-existing', taskSID: 'task1' };
    const event2: Body = { workspaceSID: 'WSxxx', taskSID: 'non-existing' };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Workspace does not exists');
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Task does not exists');
    };

    await setTaskInsightsData(baseContext, event1, callback1);
    await setTaskInsightsData(baseContext, event2, callback2);
  });

  test('Should return status 200 (no customers)', async () => {
    const event: Body = { workspaceSID: 'WSxxx', taskSID: 'task1' };

    const expected = {
      ...tasks.find(t => t.sid === 'task1'),
      attributes:
        '{"customers":{"customer1":"customer1"},"conversations":{"conversation_id":"task1"}}',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
    };

    await setTaskInsightsData(baseContext, event, callback);
  });

  test('Should return status 200 (with customers)', async () => {
    const event: Body = {
      workspaceSID: 'WSxxx',
      taskSID: 'task1',
      customers: '{"customer2":"customer2"}',
      // conversations: '',
    };

    const expected = {
      ...tasks.find(t => t.sid === 'task1'),
      attributes:
        '{"customers":{"customer1":"customer1","customer2":"customer2"},"conversations":{"conversation_id":"task1"}}',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
    };

    await setTaskInsightsData(baseContext, event, callback);
  });
});
