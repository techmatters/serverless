import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  handler as addCustomerExternalId,
  Body,
} from '../functions/addCustomerExternalId.protected';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [];

const createTask = (sid: string, options: any) => {
  return {
    sid,
    ...options,
    fetch: async () => tasks.find(t => t.sid === sid),
    update: async ({ attributes }: { attributes: any }) => {
      tasks = tasks.map(t => (t.sid === sid ? { ...t, attributes } : t));
      const task = tasks.find(t => t.sid === sid);
      return task;
    },
  };
};

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (sid: string) => {
      if (sid === 'non-existing') throw new Error('Not existing task');
      return tasks.find(t => t.sid === sid);
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
  TWILIO_WORKSPACE_SID: 'WSxxx',
};

const liveAttributes = { some: 'some', customers: { other: 1 } };
const offlineAttributes = { some: 'some', isContactlessTask: true };

beforeAll(() => {
  helpers.setup({});
  tasks = [
    ...tasks,
    createTask('live-contact', { attributes: JSON.stringify(liveAttributes) }),
    createTask('offline-contact', {
      attributes: JSON.stringify(offlineAttributes),
    }),
  ];
});
afterAll(() => {
  helpers.teardown();
});

test('Should return status 500', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'non-existing',
  };

  const callback: ServerlessCallback = (err, result) => {
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(500);
    expect(response.getBody().toString()).toContain('Not existing task');
  };

  await addCustomerExternalId(baseContext, event, callback);
});

test('Should return status 200 (modify live contact)', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'live-contact',
  };

  const callback: ServerlessCallback = (err, result) => {
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(200);
    expect(JSON.parse(JSON.parse(response.getBody()).attributes)).toEqual({
      ...liveAttributes,
      customers: { ...liveAttributes.customers, external_id: 'live-contact' },
    });
  };

  await addCustomerExternalId(baseContext, event, callback);
});

test('Should return status 200 (ignores offline contact)', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'offline-contact',
  };

  const callback: ServerlessCallback = (err, result) => {
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(200);
    expect(JSON.parse(tasks.find(t => t.sid === 'offline-contact').attributes)).toEqual(
      offlineAttributes,
    );
    expect(JSON.parse(response.getBody()).message).toContain('Is contactless task');
  };

  await addCustomerExternalId(baseContext, event, callback);
});

test('Should return status 200 (ignores other events)', async () => {
  const event: Body = {
    EventType: 'other.event',
    TaskSid: 'something',
  };

  const callback: ServerlessCallback = (err, result) => {
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(200);
    expect(JSON.parse(response.getBody()).message).toContain('Is not a new task');
  };

  await addCustomerExternalId(baseContext, event, callback);
});
