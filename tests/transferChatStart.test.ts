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
import {
  InteractionChannelParticipantInstance,
  InteractionChannelParticipantListInstance,
} from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel/interactionChannelParticipant';
import { handler as transferChatStart, Body } from '../functions/transferChatStart';

import helpers, { MockedResponse } from './helpers';
import MockedFunction = jest.MockedFunction;

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

let tasks: any[] = [
  {
    sid: 'task1',
    taskChannelUniqueName: 'channel',
    attributes: '{"channelSid":"channel"}',
    fetch: async () => tasks.find((t) => t.sid === 'task1'),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find((t) => t.sid === 'task1');
      tasks = tasks.map((t) => {
        if (t.sid === task.sid) {
          return {
            ...task,
            attributes: attributes || task.attributes,
            assignmentStatus: assignmentStatus || task.assignmentStatus,
            reason: reason || task.reason,
          };
        }
        return t;
      });

      return task;
    },
  },
  {
    sid: 'task2',
    taskChannelUniqueName: 'channel2',
    attributes: '{"channelSid":"channel"}',
    fetch: async () => tasks.find((t) => t.sid === 'task2'),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find((t) => t.sid === 'task2');
      tasks = tasks.map((t) => {
        if (t.sid === task.sid) {
          return {
            ...task,
            attributes: attributes || task.attributes,
            assignmentStatus: assignmentStatus || task.assignmentStatus,
            reason: reason || task.reason,
          };
        }
        return t;
      });

      return task;
    },
  },
  {
    sid: 'conversationTask',
    taskChannelUniqueName: 'channel',
    attributes: JSON.stringify({
      conversationSid: 'CHxxx',
      channelSid: 'CHxxx',
      flexInteractionSid: 'KDxxx',
      flexInteractionChannelSid: 'UOxxx',
    }),
    fetch: async () => tasks.find((t) => t.sid === 'conversationTask'),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find((t) => t.sid === 'conversationTask');
      tasks = tasks.map((t) => {
        if (t.sid === task.sid) {
          return {
            ...task,
            attributes: attributes || task.attributes,
            assignmentStatus: assignmentStatus || task.assignmentStatus,
            reason: reason || task.reason,
          };
        }
        return t;
      });

      return task;
    },
  },
];

const originalTaskCount = tasks.length;

const channels: { [x: string]: string[] } = {};

let configurableCapacity: number | undefined = 1;

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find((t) => t.sid === taskSid);
      if (task) return task;

      throw new Error('Task does not exists');
    },
    workers: (worker: string) => {
      if (worker === 'WK offline worker') {
        return {
          fetch: async () => ({ available: false }),
          workerChannels: () => ({
            fetch: async () => ({ availableCapacityPercentage: 1, configuredCapacity: 2 }),
          }),
        };
      }

      return {
        fetch: async () => ({
          available: true,
          attributes: JSON.stringify({ maxMessageCapacity: configurableCapacity }),
        }),
        workerChannels: (taskChannelUniqueName: string) => {
          if (taskChannelUniqueName === 'channel') {
            return {
              fetch: async () => ({ availableCapacityPercentage: 1, configuredCapacity: 2 }),
            };
          }

          if (taskChannelUniqueName === 'channel2') {
            return {
              fetch: async () => ({ availableCapacityPercentage: 0, configuredCapacity: 1 }),
            };
          }

          throw new Error('Channel does not exists');
        },
      };
    },
    taskQueues: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      list: (options: any) => [{ sid: 'TQxxx' }],
    },
  },
};

workspaces.WSxxx.tasks.create = async (options: any) => {
  const newTask = {
    ...options,
    sid: 'newTaskSid',
  };
  tasks.push(newTask);

  const channel = options.taskChannel;

  if (channels[channel] === undefined) channels[channel] = ['worker2'];
  else channels[channel].push('worker2');

  return newTask;
};

const mockedCreateInvite = jest.fn().mockResolvedValue({
  routing: {
    properties: {
      sid: 'newTaskSid',
    },
  },
});

const mockInteractionChannelParticipantList: MockedFunction<
  InteractionChannelParticipantListInstance['list']
> = jest.fn().mockResolvedValue([]);

const baseContext = {
  getTwilioClient: (): any => ({
    taskrouter: {
      workspaces: (workspaceSID: string) => {
        if (workspaces[workspaceSID]) return workspaces[workspaceSID];

        throw new Error('Workspace does not exists');
      },
    },
    chat: {
      services: (serviceSid: string) => {
        if (serviceSid === baseContext.CHAT_SERVICE_SID) {
          return {
            channels: (channelSid: string) => {
              if (channels[channelSid]) {
                return {
                  members: (memberSid: string) => {
                    if (channels[channelSid].includes(memberSid)) {
                      return {
                        remove: async () => {
                          channels[channelSid] = channels[channelSid].filter(
                            (v) => v !== memberSid,
                          );
                          return true;
                        },
                      };
                    }

                    throw new Error('Member is not participant');
                  },
                };
              }

              throw new Error('Error retrieving chat channel');
            },
          };
        }

        throw new Error('Error retrieving chat service');
      },
    },
    flexApi: {
      v1: {
        interaction: {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          get: (interactionSid: string) => ({
            channels: {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              get: (channelSid: string) => ({
                invites: {
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  create: mockedCreateInvite,
                },
                participants: {
                  list: mockInteractionChannelParticipantList,
                },
              }),
            },
          }),
        },
      },
    },
    conversations: {
      conversations: (conversationSid: string) => {
        if (conversationSid) {
          return {
            fetch: async () =>
              Promise.resolve({
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                participants: (participantSid: string) => ({
                  list: async () =>
                    Promise.resolve([{ sid: 'participantSid', identity: 'identity' }]),
                }),
              }),
          };
        }

        throw new Error('Error retrieving conversation');
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  TWILIO_WORKSPACE_SID: 'WSxxx',
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: 'WWxxx',
  TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID: 'WWyyy',
  CHAT_SERVICE_SID: 'ISxxx',
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
  channels.channel = ['worker1'];
  mockInteractionChannelParticipantList.mockClear();
});

afterEach(() => {
  if (tasks.length > originalTaskCount) tasks = tasks.slice(0, originalTaskCount);
});

describe('transferChatStart (with maxMessageCapacity set)', () => {
  test('Should return status 400', async () => {
    const event0 = { request: { cookies: {}, headers: {} } };
    const event1: Body = {
      taskSid: undefined,
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    const event2: Body = {
      taskSid: 'task1',
      targetSid: undefined,
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    const event3: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: undefined,
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    const event4: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: undefined,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [event0, event1, event2, event3, event4].map((event) =>
        transferChatStart(baseContext, event, callback),
      ),
    );
  });

  test('Should return status 403', async () => {
    const event1: Body = {
      taskSid: 'task1',
      targetSid: 'WK offline worker',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const event2: Body = {
      taskSid: 'task2',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().message).toContain("Error: can't transfer to an offline counselor");
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().message).toContain('Error: counselor has no available capacity');
    };

    await transferChatStart(baseContext, event1, callback1);
    await transferChatStart(baseContext, event2, callback2);
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const event2: Body = {
      taskSid: 'non existing',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
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
      expect(response.getBody().message).toContain('Task does not exists');
    };

    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    const payload: any = { getTwilioClient, DOMAIN_NAME };
    await transferChatStart(payload, event1, callback1);
    await transferChatStart(baseContext, event2, callback2);
  });

  test('Should return status 200 (WARM)', async () => {
    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'WARM',
      request: { cookies: {}, headers: {} },
    };
    const before = Array.from(tasks);
    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find((t) => t.sid === 'task1');
      const newTask = tasks.find((t) => t.sid === 'newTaskSid');

      const expectedNewAttr =
        '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask).toStrictEqual(before[0]);
      expect(tasks).toHaveLength(originalTaskCount + 1);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
      expect(channels.channel).toContain('worker1');
      expect(channels.channel).toContain('worker2');
    };

    await transferChatStart(baseContext, event, callback);
  });

  test('Should return status 200 (COLD)', async () => {
    // Make task initially assigned
    await tasks[0].update({
      assignmentStatus: 'assigned',
      reason: undefined,
    });

    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    const expectedOldAttr =
      '{"channelSid":"CH00000000000000000000000000000000","proxySessionSID":"KC00000000000000000000000000000000"}';
    const expectedNewAttr =
      '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find((t) => t.sid === 'task1');
      const newTask = tasks.find((t) => t.sid === 'newTaskSid');

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask.attributes).toBe(expectedOldAttr);
      expect(originalTask.reason).toBe(undefined); // Task doesn't go to wrapping anymore
      expect(originalTask.assignmentStatus).toBe('assigned'); // Task doesn't go to wrapping anymore
      expect(tasks).toHaveLength(originalTaskCount + 1);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
      expect(channels.channel).toContain('worker1'); // Counselor is not being kicked anymore
      expect(channels.channel).toContain('worker2');
    };

    await transferChatStart(baseContext, event, callback);
  });
});

describe('transferChatStart (without maxMessageCapacity set)', () => {
  configurableCapacity = undefined;

  test('Should return status 403', async () => {
    const event1: Body = {
      taskSid: 'task1',
      targetSid: 'WK offline worker',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const event2: Body = {
      taskSid: 'task2',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().message).toContain("Error: can't transfer to an offline counselor");
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().message).toContain('Error: counselor has no available capacity');
    };

    await transferChatStart(baseContext, event1, callback1);
    await transferChatStart(baseContext, event2, callback2);
  });

  test('Should return status 200 (COLD withouth having maxMessageCapacity)', async () => {
    // reset task attributes
    await tasks[0].update({
      attributes: '{"channelSid":"channel"}',
      assignmentStatus: 'assigned',
      reason: undefined,
    });

    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    const expectedOldAttr =
      '{"channelSid":"CH00000000000000000000000000000000","proxySessionSID":"KC00000000000000000000000000000000"}';
    const expectedNewAttr =
      '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find((t) => t.sid === 'task1');
      const newTask = tasks.find((t) => t.sid === 'newTaskSid');

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask.attributes).toBe(expectedOldAttr);
      expect(originalTask.reason).toBe(undefined); // Task doesn't go to wrapping anymore
      expect(originalTask.assignmentStatus).toBe('assigned'); // Task doesn't go to wrapping anymore
      expect(tasks).toHaveLength(originalTaskCount + 1);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
      expect(channels.channel).toContain('worker1'); // Counselor is not being kicked anymore
      expect(channels.channel).toContain('worker2');
    };

    await transferChatStart(baseContext, event, callback);
  });
});

describe('Conversations', () => {
  beforeEach(() => {
    mockInteractionChannelParticipantList.mockResolvedValue([
      { sid: 'notParticipantSid', type: 'customer' } as InteractionChannelParticipantInstance,
      { sid: 'participantSid', type: 'agent' } as InteractionChannelParticipantInstance,
    ]);
  });
  test('Transfer to worker', async () => {
    const event: Body = {
      taskSid: 'conversationTask',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };
    let result: any;
    const callback: ServerlessCallback = (err, cbResult) => {
      result = cbResult;
    };

    await transferChatStart(baseContext, event, callback);
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(200);
    expect(response.getBody()).toStrictEqual({ taskSid: 'newTaskSid' });
    expect(mockedCreateInvite).toHaveBeenCalledWith({
      routing: {
        properties: {
          worker_sid: 'WKxxx',
          workflow_sid: baseContext.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
          workspace_sid: baseContext.TWILIO_WORKSPACE_SID,
          attributes: {
            channelSid: 'CHxxx',
            conversationSid: 'CHxxx',
            conversations: {
              conversation_id: 'conversationTask',
            },
            ignoreAgent: 'worker1',
            originalParticipantSid: 'participantSid',
            targetSid: 'WKxxx',
            transferTargetType: 'worker',
            flexInteractionChannelSid: 'UOxxx',
            flexInteractionSid: 'KDxxx',
          },
          task_channel_unique_name: 'channel',
        },
      },
    });
  });
  test('Transfer to queue', async () => {
    const event: Body = {
      taskSid: 'conversationTask',
      targetSid: 'WQxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual({ taskSid: 'newTaskSid' });
      expect(mockedCreateInvite).toHaveBeenCalledWith({
        routing: {
          properties: {
            workflow_sid: baseContext.TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID,
            workspace_sid: baseContext.TWILIO_WORKSPACE_SID,
            attributes: {
              channelSid: 'CHxxx',
              conversationSid: 'CHxxx',
              conversations: {
                conversation_id: 'conversationTask',
              },
              ignoreAgent: 'worker1',
              originalParticipantSid: 'participantSid',
              targetSid: 'WQxxx',
              transferTargetType: 'queue',
              flexInteractionChannelSid: 'UOxxx',
              flexInteractionSid: 'KDxxx',
            },
            task_channel_unique_name: 'channel',
          },
        },
      });
    };

    await transferChatStart(baseContext, event, callback);
  });
});
