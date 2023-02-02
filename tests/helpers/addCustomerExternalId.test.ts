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

import { addCustomerExternalId, Body } from '../../functions/helpers/addCustomerExternalId.private';

import helpers from '../helpers';

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

const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(() => {
  helpers.setup({});
  tasks = [...tasks, createTask('live-contact', { attributes: JSON.stringify(liveAttributes) })];
});
afterAll(() => {
  helpers.teardown();
});
afterEach(() => {
  logSpy.mockClear();
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
  expect(logSpy).toHaveBeenCalledWith(expectedError, new Error("can't fetch this one!"));
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
  expect(logSpy).toHaveBeenCalledWith(expectedError, new Error("can't update this one!"));
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
