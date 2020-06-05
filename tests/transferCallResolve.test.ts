import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as transferCallResolve, Body } from '../functions/transferCallResolve';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [];

const createTask = (taskSid: string, reservationsList: string[]) => {
  tasks.push({
    sid: taskSid,
    reservationsList: reservationsList.reduce(
      (acc, reservationSid) => ({
        ...acc,
        [reservationSid]: {
          sid: reservationSid,
          reservationStatus: 'accepted',
          update: async ({ reservationStatus }: { reservationStatus: string }) => {
            const task = tasks.find(t => t.sid === taskSid);
            task.reservationsList[reservationSid].reservationStatus = reservationStatus;
            return task.reservationsList[reservationSid];
          },
        },
      }),
      {},
    ),
    reservations: (reservationSid: string) => {
      const task = tasks.find(t => t.sid === taskSid);
      const reservation = task.reservationsList[reservationSid];

      if (reservation) return reservation;

      throw new Error('Reservation does not exists');
    },
  });
};

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
  TWILIO_WORKSPACE_SID: 'WSxxx',
};

describe('transferCallResolve', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  beforeEach(() => {
    tasks = [];
    createTask('task1', ['reservation1', 'reservation2']);
  });

  test('Should return status 400', async () => {
    const event1: Body = {
      taskSid: undefined,
      reservationSid: 'reservation1',
    };
    const event2: Body = {
      taskSid: 'task1',
      reservationSid: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [{}, event1, event2].map(event => transferCallResolve(baseContext, event, callback)),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      taskSid: 'non existing',
      reservationSid: 'reservation1',
    };
    const event2: Body = {
      taskSid: 'task1',
      reservationSid: 'non existing',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Task does not exists');
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Reservation does not exists');
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Workspace does not exists');
    };

    await transferCallResolve(baseContext, event1, callback1);
    await transferCallResolve(baseContext, event2, callback2);
    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    await transferCallResolve({ getTwilioClient, DOMAIN_NAME }, event1, callback3);
  });

  test('Should return status 200 (close original)', async () => {
    const event: Body = {
      taskSid: 'task1',
      reservationSid: 'reservation1',
    };

    const expected = { closed: 'reservation1' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      const task = tasks.find(t => t.sid === 'task1');
      const { reservation1, reservation2 } = task.reservationsList;
      expect(reservation1.reservationStatus).toBe('completed');
      expect(reservation2.reservationStatus).toBe('accepted'); // remains unchanged
    };

    await transferCallResolve(baseContext, event, callback);
  });
});
