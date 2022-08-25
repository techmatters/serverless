import { addCustomerExternalId, Body } from '../../functions/helpers/addCustomerExternalId.private';

import helpers from '../helpers';

let tasks: any[] = [];

const createTask = (sid: string, options: any) => {
  return {
    sid,
    ...options,
    fetch: async () => tasks.find((t) => t.sid === sid),
    update: async ({ attributes }: { attributes: any }) => {
      tasks = tasks.map((t) => (t.sid === sid ? { ...t, attributes } : t));
      const task = tasks.find((t) => t.sid === sid);
      return task;
    },
  };
};

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (sid: string) => {
      if (sid === 'non-existing') throw new Error('Not existing task');
      return tasks.find((t) => t.sid === sid);
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
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
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

test('Should throw (Not existing task)', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'non-existing',
  };

  expect(() => addCustomerExternalId(baseContext, event)).rejects.toThrowError('Not existing task');
});

test('Should return OK (modify live contact)', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'live-contact',
  };

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe('Task updated');
  expect(JSON.parse(result.updatedTask!.attributes)).toEqual({
    ...liveAttributes,
    customers: { ...liveAttributes.customers, external_id: 'live-contact' },
  });
});

test('Should return status 200 (ignores offline contact)', async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'offline-contact',
  };

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe('Is contactless task');
  expect(JSON.parse(tasks.find((t) => t.sid === 'offline-contact').attributes)).toEqual(
    offlineAttributes,
  );
});

test('Should return status 200 (ignores other events)', async () => {
  const event: Body = {
    EventType: 'other.event',
    TaskSid: 'something',
  };

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe('Event is not task.created');
});
