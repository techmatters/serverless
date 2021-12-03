import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as assignOfflineContact, Body } from '../functions/assignOfflineContact';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [];

const createReservation = (taskSid: string, workerSid: string) => {
  const task = tasks.find(t => t.sid === taskSid);
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

const createTask = (sid: string, options: any) => {
  return {
    sid,
    ...options,
    reservations: () => ({
      list: async () => [],
    }),
    update: async ({ attributes }: { attributes: any }) => {
      tasks = tasks.map(t => (t.sid === sid ? { ...t, attributes } : t));

      const hasReservation =
        (
          await tasks
            .find(t => t.sid === sid)
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
      )
        createReservation(sid, targetSid);

      const task = tasks.find(t => t.sid === sid);
      return task;
    },
    remove: async () => {
      tasks = tasks.filter(t => t.sid === sid);
    },
  };
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

        return tasks.find(t => t.sid === newTask.sid);
      },
    },
    workers: (workerSid: string) => ({
      fetch: () => {
        if (workerSid === 'noHelpline-worker')
          return {
            attributes: JSON.stringify({}),
            sid: 'waitingOfflineContact-worker',
            available: true,
          };

        if (workerSid === 'waitingOfflineContact-worker')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: true, helpline: 'helpline' }),
            sid: 'waitingOfflineContact-worker',
            available: true,
          };

        if (workerSid === 'available-worker-no-reservation')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            sid: 'available-worker-no-reservation',
            available: true,
          };

        if (workerSid === 'not-available-worker-no-reservation')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-reservation',
            available: false,
            update: updateWorkerMock,
          };

        if (workerSid === 'available-worker-with-reservation')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            sid: 'available-worker-with-reservation',
            available: true,
            update: updateWorkerMock,
          };

        if (workerSid === 'not-available-worker-with-reservation')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-reservation',
            available: false,
            update: updateWorkerMock,
          };

        if (workerSid === 'available-worker-with-accepted')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            sid: 'available-worker-with-accepted',
            available: true,
            update: updateWorkerMock,
          };

        if (workerSid === 'not-available-worker-with-accepted')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-accepted',
            available: false,
            update: updateWorkerMock,
          };

        if (workerSid === 'available-worker-with-completed')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            sid: 'available-worker-with-completed',
            available: true,
            update: updateWorkerMock,
          };

        if (workerSid === 'not-available-worker-with-completed')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            activitySid: 'activitySid',
            sid: 'not-available-worker-with-completed',
            available: false,
            update: updateWorkerMock,
          };

        if (workerSid === 'intentionallyThrow')
          return {
            attributes: JSON.stringify({ waitingOfflineContact: false, helpline: 'helpline' }),
            activitySid: 'activitySid',
            sid: 'intentionallyThrow',
            available: true,
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
    const bad2: Body = {
      targetSid: 'WKxxx',
      // @ts-ignore
      finalTaskAttributes: undefined,
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
      targetSid: 'non-existing-worker',
      finalTaskAttributes: JSON.stringify({}),
    };

    const eventNoHelplineWorker: Body = {
      targetSid: 'noHelpline-worker',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event3: Body = {
      targetSid: 'waitingOfflineContact-worker',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event4: Body = {
      targetSid: 'intentionallyThrow',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event5: Body = {
      targetSid: 'available-worker-no-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event6: Body = {
      targetSid: 'not-available-worker-no-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event7: Body = {
      targetSid: 'available-worker-with-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event8: Body = {
      targetSid: 'not-available-worker-with-reservation',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event9: Body = {
      targetSid: 'available-worker-with-accepted',
      finalTaskAttributes: JSON.stringify({}),
    };

    const event10: Body = {
      targetSid: 'not-available-worker-with-accepted',
      finalTaskAttributes: JSON.stringify({}),
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Workspace does not exists');
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Non existing worker');
    };

    const callbackNoHelplineWorker: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'Error: the worker does not have helpline attribute set, check the worker configuration.',
      );
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'Error: the worker is already waiting for an offline contact.',
      );
    };

    const callback4: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Intentionally thrown error');
    };

    const callback5: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not created.');
      expect(updateWorkerMock).not.toBeCalled();
    };

    const callback6: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not created.');
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    const callback7: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not accepted.');
      expect(updateWorkerMock).not.toBeCalled();
    };

    const callback8: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not accepted.');
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    const callback9: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not completed.');
      expect(updateWorkerMock).not.toBeCalled();
    };

    const callback10: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Error: reservation for task not completed.');
      expect(updateWorkerMock).toBeCalledTimes(2);
    };

    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    updateWorkerMock.mockClear();
    await assignOfflineContact({ getTwilioClient, DOMAIN_NAME }, event1, callback1);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event2, callback2);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, eventNoHelplineWorker, callbackNoHelplineWorker);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event3, callback3);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event4, callback4);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event5, callback5);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event6, callback6);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event7, callback7);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event8, callback8);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event9, callback9);
    updateWorkerMock.mockClear();
    await assignOfflineContact(baseContext, event10, callback10);
  });

  test('Should return status 200 (available worker)', async () => {
    const event: Body = {
      targetSid: 'available-worker-with-completed',
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
      targetSid: 'not-available-worker-with-completed',
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
