import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as assignOfflineContact, Body } from '../functions/assignOfflineContact';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [];

const createTask = (sid: string, options: any) => {
  return {
    sid,
    ...options,
    reservations: () => ({
      list: async () => [],
    }),
    remove: async () => {
      tasks = tasks.filter(t => t.sid === sid);
    },
  };
};

const createReservation = (taskSid: string, workerSid: string) => {
  const task = tasks.find(t => t.sid === taskSid);
  const updateMock = jest.fn();
  const withReservation = {
    ...task,
    reservations: () => ({
      list: async () => [
        {
          workerSid,
          update: updateMock,
        },
      ],
    }),
  };

  tasks = tasks.map(t => (t.sid === taskSid ? withReservation : t));
  return updateMock;
};

const updateWorkerMock = jest.fn();

const workspaces: { [x: string]: any } = {
  WSxxx: {
    activities: {
      list: async () => [
        {
          sid: 'Available',
          friendlyName: 'Available',
        },
      ],
    },
    tasks: {
      create: async (options: any) => {
        const attributes = JSON.parse(options.attributes);
        if (attributes.targetSid === 'intentionallyThrow')
          throw new Error('Intentionally thrown error');

        const newTask = createTask(Math.random().toString(), options);

        tasks = [...tasks, newTask];

        if (
          ['available-worker-with-reservation', 'not-available-worker-with-reservation'].includes(
            attributes.targetSid,
          )
        )
          createReservation(newTask.sid, attributes.targetSid);

        return tasks.find(t => t.sid === newTask.sid);
      },
    },
    workers: (workerSid: string) => ({
      fetch: () => {
        if (workerSid === 'available-worker-no-reservation')
          return {
            sid: 'available-worker-no-reservation',
            available: true,
          };

        if (workerSid === 'available-worker-with-reservation')
          return {
            sid: 'available-worker-with-reservation',
            available: true,
          };

        if (workerSid === 'not-available-worker-no-reservation')
          return {
            attributes: JSON.stringify({}),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-reservation',
            available: false,
            update: updateWorkerMock,
          };

        if (workerSid === 'not-available-worker-with-reservation')
          return {
            attributes: JSON.stringify({}),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-reservation',
            available: false,
            update: updateWorkerMock,
          };

        throw new Error('Non existing worker');
      },
    }),
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
  TWILIO_WORKSPACE_SID: 'WSxxx',
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: 'WWxxx',
};

beforeAll(() => {
  helpers.setup({});
});
afterAll(() => {
  helpers.teardown();
});

afterEach(() => {
  tasks = [];
  updateWorkerMock.mockClear();
});

describe('assignOfflineContact', () => {
  test('Should return status 400', async () => {
    const bad1: Body = {
      targetSid: undefined,
      finalTaskAttributes: JSON.stringify({}),
    };
    // @ts-ignore
    const bad2: Body = {
      targetSid: 'WKxxx',
      // finalTaskAttributes: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [{}, bad1, bad2].map(event => assignOfflineContact(baseContext, event, callback)),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      targetSid: 'WKxxx',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event2: Body = {
      targetSid: 'intentionallyThrow',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event3: Body = {
      targetSid: 'non-existing-worker',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event4: Body = {
      targetSid: 'available-worker-no-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event5: Body = {
      targetSid: 'not-available-worker-no-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

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
      expect(response.getBody().toString()).toContain('Intentionally thrown error');
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Non existing worker');
    };

    const callback4: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Error: reservation for task not created.');
      expect(updateWorkerMock).not.toBeCalled();
    };

    const callback5: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Error: reservation for task not created.');
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    await assignOfflineContact({ getTwilioClient, DOMAIN_NAME }, event1, callback1);
    await assignOfflineContact(baseContext, event2, callback2);
    await assignOfflineContact(baseContext, event3, callback3);
    await assignOfflineContact(baseContext, event4, callback4);
    await assignOfflineContact(baseContext, event5, callback5);
  });

  test('Should return status 200 (available worker)', async () => {
    const event: Body = {
      targetSid: 'available-worker-with-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(updateWorkerMock).not.toBeCalled();
    };

    await assignOfflineContact(baseContext, event, callback);
  });

  test('Should return status 200 (not available worker)', async () => {
    const event: Body = {
      targetSid: 'not-available-worker-with-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    await assignOfflineContact(baseContext, event, callback);
  });
});
