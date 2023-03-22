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

import {
  EventFields,
  EventType,
  RESERVATION_ACCEPTED,
  RESERVATION_REJECTED,
  RESERVATION_WRAPUP,
  TASK_QUEUE_ENTERED,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';
import each from 'jest-each';

import * as transfersListener from '../../functions/taskrouterListeners/transfersListener.private';

type Map<T> = {
  [key: string]: T;
};

type Reservation = {
  reservationStatus: string;
  update: (payload: any) => any;
};

type Task = {
  sid: string;
  attributes: any;
  fetch: (payload: any) => any;
  update: (payload: any) => any;
  reservations: (payload: any) => Reservation;
};

type Workspace = {
  tasks: (taskSid: string) => Task;
};

const defaultAttributes = {
  channelSid: 'channelSid',
  transferStarted: true,
  transferMeta: {
    originalTask: 'original-task',
    originalReservation: 'originalReservation-sid',
    originalCounselor: 'originalCounselor-sid',
    originalCounselorName: 'originalCounselorName',
    sidWithTaskControl: 'WR00000000000000000000000000000000',
    transferStatus: 'accepted',
    mode: 'COLD',
    targetType: 'worker',
  },
};

const defaultWarmVoiceAttributes = {
  ...defaultAttributes,
  transferMeta: {
    ...defaultAttributes.transferMeta,
    originalTask: 'original-task-warm-voice',
    sidWithTaskControl: '',
    transferStatus: 'transferring',
    mode: 'WARM',
  },
};

const defaultColdVoiceAttributes = {
  ...defaultAttributes,
  transferMeta: {
    ...defaultAttributes.transferMeta,
    originalTask: 'original-task-cold-voice',
    transferStatus: 'accepted',
    mode: 'COLD',
  },
};

const originalTaskVoiceReservation = {
  reservationStatus: 'assigned',
  update: jest.fn(),
};

const tasks: Map<Task> = {
  'original-task': {
    sid: 'original-task',
    attributes: JSON.stringify(defaultAttributes),
    fetch: () => Promise.resolve(tasks['original-task']),
    update: jest.fn(),
    reservations: jest.fn(),
  },
  'second-task': {
    sid: 'second-task',
    attributes: JSON.stringify(defaultAttributes),
    fetch: () => Promise.resolve(tasks['second-task']),
    update: jest.fn(),
    reservations: jest.fn(),
  },
  'original-task-warm-voice': {
    sid: 'original-task-warm-voice',
    attributes: JSON.stringify(defaultWarmVoiceAttributes),
    fetch: () => Promise.resolve(tasks['original-task-warm-voice']),
    update: jest.fn(),
    reservations: () => originalTaskVoiceReservation,
  },
  'original-task-cold-voice': {
    sid: 'original-task-cold-voice',
    attributes: JSON.stringify(defaultColdVoiceAttributes),
    fetch: () => Promise.resolve(tasks['original-task-cold-voice']),
    update: jest.fn(),
    reservations: () => originalTaskVoiceReservation,
  },
};

const workspaces: Map<Workspace> = {
  WSxxx: {
    tasks: (taskSid: string): Task => {
      const task = tasks[taskSid];
      if (task) return task;

      throw new Error('Task does not exists');
    },
  },
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const context = {
  ...mock<Context<EnvVars>>(),
  getTwilioClient: (): any => ({
    taskrouter: {
      workspaces: (workspaceSID: string) => {
        if (workspaces[workspaceSID]) return workspaces[workspaceSID];

        throw new Error('Workspace does not exists');
      },
    },
  }),
  TWILIO_WORKSPACE_SID: 'WSxxx',
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('Chat transfers', () => {
  test('accepted reservation for worker transfer - marks original task copmleted', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'worker' }),
    };

    await transfersListener.handleEvent(context, event);

    const payload = {
      assignmentStatus: 'completed',
      reason: 'task transferred accepted',
    };

    expect(tasks['original-task'].update).toHaveBeenCalledWith(payload);
  });

  test('accept reservation for queue transfer - does nothing', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'queue' }),
    };

    await transfersListener.handleEvent(context, event);

    expect(tasks['original-task'].update).not.toHaveBeenCalled();
    expect(tasks['second-task'].update).not.toHaveBeenCalled();
  });

  test('task queue entered for queue transfer - marks original task complete ', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_QUEUE_ENTERED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'queue' }),
    };

    await transfersListener.handleEvent(context, event);

    const payload = {
      assignmentStatus: 'completed',
      reason: 'task transferred into queue',
    };

    expect(tasks['original-task'].update).toHaveBeenCalledWith(payload);
  });

  test('task queue entered for worker transfer - does nothing', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_QUEUE_ENTERED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'worker' }),
    };

    await transfersListener.handleEvent(context, event);

    expect(tasks['original-task'].update).not.toHaveBeenCalledWith();
  });

  test('accept queue transfer - does nothing', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'queue' }),
    };

    await transfersListener.handleEvent(context, event);

    expect(tasks['original-task'].update).not.toHaveBeenCalled();
    expect(tasks['second-task'].update).not.toHaveBeenCalled();
  });

  test('rejected reservation for worker transfer - cancels transfer task & updates the original with transfer task changes', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_REJECTED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'worker' }),
    };

    await transfersListener.handleEvent(context, event);

    const taskAttributes = JSON.parse(tasks['second-task'].attributes);

    const attributesWithChannelSid = {
      ...taskAttributes,
      channelSid: 'channelSid',
      transferMeta: {
        ...taskAttributes.transferMeta,
        sidWithTaskControl: 'originalReservation-sid',
      },
    };

    const attributesPayload = {
      attributes: JSON.stringify(attributesWithChannelSid),
    };

    const canceledPayload = {
      assignmentStatus: 'canceled',
      reason: 'task transferred rejected',
    };

    console.log((tasks['original-task'].update as jest.Mock).mock.calls);
    expect(tasks['original-task'].update).toHaveBeenCalledWith(attributesPayload);
    expect(tasks['second-task'].update).toHaveBeenCalledWith(canceledPayload);
  });

  test('rejected reservation for queue transfer - does nothing', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_REJECTED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'second-task',
      TaskAttributes: JSON.stringify({ ...defaultAttributes, transferTargetType: 'queue' }),
    };

    await transfersListener.handleEvent(context, event);

    expect(tasks['original-task'].update).not.toHaveBeenCalled();
    expect(tasks['second-task'].update).not.toHaveBeenCalled();
  });
});

describe('Voice transfers', () => {
  test('rejected warm transfer', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_REJECTED as EventType,
      TaskChannelUniqueName: 'voice',
      TaskSid: 'original-task-warm-voice',
      TaskAttributes: tasks['original-task-warm-voice'].attributes,
    };

    await transfersListener.handleEvent(context, event);

    const taskAttributes = JSON.parse(tasks['original-task-warm-voice'].attributes);

    const attributesWithChannelSid = {
      ...taskAttributes,
      transferMeta: {
        ...taskAttributes.transferMeta,
        sidWithTaskControl: 'originalReservation-sid',
        transferStatus: 'rejected',
      },
    };

    const attributesPayload = {
      attributes: JSON.stringify(attributesWithChannelSid),
    };

    expect(tasks['original-task-warm-voice'].update).toHaveBeenCalledWith(attributesPayload);
  });

  test('rejected cold transfer', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_REJECTED as EventType,
      TaskChannelUniqueName: 'voice',
      TaskSid: 'original-task-cold-voice',
      TaskAttributes: tasks['original-task-cold-voice'].attributes,
    };

    await transfersListener.handleEvent(context, event);

    expect(tasks['original-task-cold-voice'].update).not.toHaveBeenCalled();
  });

  each([
    { task: tasks['original-task-cold-voice'], transferStatus: 'accepted', expectComplete: true },
    { task: tasks['original-task-warm-voice'], transferStatus: 'accepted', expectComplete: true },
    { task: tasks['original-task-warm-voice'], transferStatus: 'rejected', expectComplete: false },
    {
      task: tasks['original-task-warm-voice'],
      transferStatus: 'transferring',
      expectComplete: false,
    },
  ]).test(
    'task $task.sid to wrapup with transferStatus $transferStatus should complete task $expectComplete',
    async ({ task, transferStatus, expectComplete }) => {
      const taskAttributes = JSON.parse(task.attributes);
      const event = {
        ...mock<EventFields>(),
        EventType: RESERVATION_WRAPUP as EventType,
        TaskChannelUniqueName: 'voice',
        TaskSid: task.sid,
        TaskAttributes: JSON.stringify({
          ...taskAttributes,
          transferMeta: {
            ...taskAttributes.transferMeta,
            transferStatus,
          },
        }),
      };

      await transfersListener.handleEvent(context, event);

      if (expectComplete) {
        expect(originalTaskVoiceReservation.update).toHaveBeenCalledWith({
          reservationStatus: 'completed',
        });
      } else {
        expect(originalTaskVoiceReservation.update).not.toHaveBeenCalled();
      }
    },
  );
});
