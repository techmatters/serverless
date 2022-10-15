import {
  addCustomerExternalId,
  Body,
  EnvVars,
} from '../../functions/helpers/addCustomerExternalId.private';

import helpers from '../helpers';
import { Context } from '@twilio-labs/serverless-runtime-types/types';

let tasks: any[] = [
  {
    sid: 'non-existing',
    fetch: () => {
      throw new Error("can't fetch this one!");
    },
  },
  {
    sid: 'non-updateable',
    attributes: JSON.stringify({}),
    fetch: async () => tasks.find((t) => t.sid === 'non-updateable'),
    update: () => {
      throw new Error("can't update this one!");
    },
  },
];

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
    tasks: (sid: string) => tasks.find((t) => t.sid === sid),
  },
};

const baseContext: Context<EnvVars> = {
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

beforeAll(() => {
  helpers.setup({});
  tasks = [...tasks, createTask('live-contact', { attributes: JSON.stringify(liveAttributes) })];
});
afterAll(() => {
  helpers.teardown();
});

test("Should log and return error (can't fetch task)", async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'non-existing',
  };

  const expectedError =
    'Error at addCustomerExternalId: task with sid non-existing does not exists in workspace WSxxx when trying to fetch it.';

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe(expectedError);
});

test("Should log and return error (can't update task)", async () => {
  const event: Body = {
    EventType: 'task.created',
    TaskSid: 'non-updateable',
  };

  const expectedError =
    'Error at addCustomerExternalId: task with sid non-updateable does not exists in workspace WSxxx when trying to update it.';

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe(expectedError);
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

test('Should return status 200 (ignores other events)', async () => {
  const event: Body = {
    EventType: 'other.event',
    TaskSid: 'live-contact',
  };

  const result = await addCustomerExternalId(baseContext, event);
  expect(result.message).toBe('Event is not task.created');
});
