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
import each from 'jest-each';
import { handler as assignOfflineContactInit, Body } from '../functions/assignOfflineContactInit';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

let tasks: any[] = [];

const createReservation = (taskSid: string, workerSid: string) => {
  const task = tasks.find((t) => t.sid === taskSid);
  task.reservationsSource = [
    {
      workerSid,
      reservationStatus: 'pending',
      update: async ({ reservationStatus }: { reservationStatus: string }) => {
        const reservation = (await task.reservations().list()).find(
          (r: any) => r.workerSid === workerSid,
        );

        if (
          reservationStatus === 'accepted' &&
          reservation.reservationStatus === 'pending' &&
          (workerSid === 'available-worker-with-accepted' ||
            workerSid === 'not-available-worker-with-accepted')
        ) {
          const accepted = { ...reservation, reservationStatus };
          task.reservationsSource = [accepted];
          return accepted;
        }

        if (
          reservationStatus === 'accepted' &&
          reservation.reservationStatus === 'pending' &&
          (workerSid === 'available-worker-with-completed' ||
            workerSid === 'not-available-worker-with-completed')
        ) {
          const accepted = { ...reservation, reservationStatus };
          task.reservationsSource = [accepted];
          return accepted;
        }

        if (
          reservationStatus === 'completed' &&
          reservation.reservationStatus === 'accepted' &&
          (workerSid === 'available-worker-with-completed' ||
            workerSid === 'not-available-worker-with-completed')
        ) {
          const completed = { ...reservation, reservationStatus };
          task.reservationsSource = [completed];
          return completed;
        }

        return reservation;
      },
    },
  ];
  task.reservations = () => ({
    list: async () => task.reservationsSource,
  });
};

const createTask = (sid: string, options: any) => ({
  sid,
  ...options,
  reservations: () => ({
    list: async () => [],
  }),
  update: async ({ attributes }: { attributes: any }) => {
    tasks = tasks.map((t) => (t.sid === sid ? { ...t, attributes } : t));

    const hasReservation =
      (
        await tasks
          .find((t) => t.sid === sid)
          .reservations()
          .list()
      ).length > 0;

    const { targetSid } = JSON.parse(attributes);
    if (
      [
        'available-worker-with-reservation',
        'not-available-worker-with-reservation',
        'available-worker-with-accepted',
        'not-available-worker-with-accepted',
        'available-worker-with-completed',
        'not-available-worker-with-completed',
      ].includes(targetSid) &&
      !hasReservation
    ) {
      createReservation(sid, targetSid);
    }

    const task = tasks.find((t) => t.sid === sid);
    return task;
  },
  remove: async () => {
    tasks = tasks.filter((t) => t.sid === sid);
  },
});

const updateWorkerMock = jest.fn();

let workspaces: { [x: string]: any } = {};

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
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

beforeAll(() => {
  helpers.setup({});
});
afterAll(() => {
  helpers.teardown();
});

beforeEach(() => {
  workspaces = {
    WSxxx: {
      activities: {
        list: async () => [
          {
            sid: 'Available',
            friendlyName: 'Available',
            available: 'true',
          },
        ],
      },
      tasks: {
        create: async (options: any) => {
          const newTask = createTask(Math.random().toString(), options);
          tasks = [...tasks, newTask];
          return tasks.find((t) => t.sid === newTask.sid);
        },
      },
      workers: (workerSid: string) => ({
        fetch: () => {
          if (workerSid === 'noHelpline-worker') {
            return {
              attributes: JSON.stringify({}),
              sid: 'waitingOfflineContact-worker',
              available: true,
            };
          }

          if (workerSid === 'waitingOfflineContact-worker') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: true, helpline: 'helpline' }),
              sid: 'waitingOfflineContact-worker',
              available: true,
            };
          }

          if (workerSid === 'available-worker-no-reservation') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              sid: 'available-worker-no-reservation',
              available: true,
            };
          }

          if (workerSid === 'not-available-worker-no-reservation') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              activitySid: 'activitySid',
              sid: 'not-available-worker-with-reservation',
              available: false,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'available-worker-with-reservation') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              sid: 'available-worker-with-reservation',
              available: true,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'not-available-worker-with-reservation') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              activitySid: 'activitySid',
              sid: 'not-available-worker-with-reservation',
              available: false,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'available-worker-with-accepted') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              sid: 'available-worker-with-accepted',
              available: true,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'not-available-worker-with-accepted') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              activitySid: 'activitySid',
              sid: 'not-available-worker-with-accepted',
              available: false,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'available-worker-with-completed') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              sid: 'available-worker-with-completed',
              available: true,
              update: updateWorkerMock,
            };
          }

          if (workerSid === 'not-available-worker-with-completed') {
            return {
              attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
              activitySid: 'activitySid',
              sid: 'not-available-worker-with-completed',
              available: false,
              update: updateWorkerMock,
            };
          }

          throw new Error('Non existing worker');
        },
      }),
    },
  };
});

afterEach(() => {
  tasks = [];
  updateWorkerMock.mockClear();
});

describe('assignOfflineContactInit', () => {
  test('Should return status 400', async () => {
    const bad1: Body = {
      targetSid: undefined,
      taskAttributes: JSON.stringify({}),
      request: { cookies: {}, headers: {} },
    };
    const bad2: Body = {
      targetSid: 'WKxxx',
      // @ts-ignore
      taskAttributes: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [bad1, bad2].map((event) => assignOfflineContactInit(baseContext, event, callback)),
    );
  });

  each([
    {
      condition: 'task creation throws an error',
      targetSid: 'available-worker-with-completed',
      expectedMessage: 'Intentionally thrown error',
      taskCreateMethod: () => {
        throw new Error('Intentionally thrown error');
      },
    },
    {
      condition: 'workspace does not exist',
      targetSid: 'WKxxx',
      expectedMessage: 'Workspace does not exists',
      context: {
        getTwilioClient: baseContext.getTwilioClient,
        DOMAIN_NAME: baseContext.DOMAIN_NAME,
      },
    },
    {
      condition: 'worker does not exist',
      targetSid: 'non-existing-worker',
      expectedMessage: 'Non existing worker',
    },
    {
      condition: 'worker has no helpline',
      targetSid: 'noHelpline-worker',
      expectedMessage:
        'Error: the worker does not have helpline attribute set, check the worker configuration.',
    },
    {
      condition: 'worker has waitingOfflineContact set',
      targetSid: 'waitingOfflineContact-worker',
      expectedMessage: 'Error: the worker is already waiting for an offline contact.',
    },
    {
      condition: 'worker is available with no reservation',
      targetSid: 'available-worker-no-reservation',
      expectedMessage: 'Error: reservation for task not created.',
    },
    {
      condition: 'worker is not available with no reservation',
      targetSid: 'not-available-worker-no-reservation',
      expectedMessage: 'Error: reservation for task not created.',
      expectedUpdatedWorkerMockCalls: 2,
    },
    {
      condition: 'worker is available with reservation',
      targetSid: 'available-worker-with-reservation',
      expectedMessage: 'Error: reservation for task not accepted.',
    },
    {
      condition: 'worker is not available with a reservation',
      targetSid: 'not-available-worker-with-reservation',
      expectedMessage: 'Error: reservation for task not accepted.',
      expectedUpdatedWorkerMockCalls: 2,
    },
  ]).test(
    "Should return status 500 '$expectedMessage' when $condition",
    async ({
      targetSid,
      expectedMessage,
      expectedUpdatedWorkerMockCalls = 0,
      context = baseContext,
      taskCreateMethod,
    }) => {
      // Patch task create method if a custom one is set
      workspaces.WSxxx.tasks.create = taskCreateMethod ?? workspaces.WSxxx.tasks.create;

      const event: Body = {
        targetSid,
        taskAttributes: JSON.stringify({}),
        request: { cookies: {}, headers: {} },
      };
      let response: MockedResponse | undefined;

      const callback: ServerlessCallback = (err, result) => {
        response = <MockedResponse | undefined>result;
      };

      updateWorkerMock.mockClear();
      await assignOfflineContactInit(context, event, callback);

      expect(response).toBeDefined();
      if (response) {
        expect(response.getStatus()).toBe(500);
        expect(response.getBody().message).toContain(expectedMessage);
      }
      expect(updateWorkerMock).toBeCalledTimes(expectedUpdatedWorkerMockCalls);
    },
  );

  test('Should return status 200 (available worker)', async () => {
    const event: Body = {
      targetSid: 'available-worker-with-completed',
      taskAttributes: JSON.stringify({}),
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(updateWorkerMock).not.toBeCalled();
    };

    await assignOfflineContactInit(baseContext, event, callback);
  });

  test('Should return status 200 (not available worker)', async () => {
    const event: Body = {
      targetSid: 'not-available-worker-with-completed',
      taskAttributes: JSON.stringify({}),
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    await assignOfflineContactInit(baseContext, event, callback);
  });
});
