import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as transferChatStart, Body } from '../functions/transferChatStart';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [
  {
    sid: 'task1',
    taskChannelUniqueName: 'channel',
    attributes: '{"channelSid":"channel"}',
    fetch: async () => tasks.find(t => t.sid === 'task1'),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find(t => t.sid === 'task1');
      tasks = tasks.map(t => {
        if (t.sid === task.sid)
          return {
            ...task,
            attributes: attributes || task.attributes,
            assignmentStatus: assignmentStatus || task.assignmentStatus,
            reason: reason || task.reason,
          };
        return t;
      });

      return task;
    },
  },
  {
    sid: 'task2',
    taskChannelUniqueName: 'channel2',
    attributes: '{"channelSid":"channel"}',
    fetch: async () => tasks.find(t => t.sid === 'task2'),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find(t => t.sid === 'task2');
      tasks = tasks.map(t => {
        if (t.sid === task.sid)
          return {
            ...task,
            attributes: attributes || task.attributes,
            assignmentStatus: assignmentStatus || task.assignmentStatus,
            reason: reason || task.reason,
          };
        return t;
      });

      return task;
    },
  },
];

const channels: { [x: string]: string[] } = {};

let configurableCapacity: number | undefined = 1;

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find(t => t.sid === taskSid);
      if (task) return task;

      throw new Error('Task does not exists');
    },
    workers: (worker: string) => {
      if (worker === 'WK offline worker')
        return {
          fetch: async () => ({ available: false }),
          workerChannels: () => ({
            fetch: async () => ({ availableCapacityPercentage: 1, configuredCapacity: 2 }),
          }),
        };

      return {
        fetch: async () => ({
          available: true,
          attributes: JSON.stringify({ maxMessageCapacity: configurableCapacity }),
        }),
        workerChannels: (taskChannelUniqueName: string) => {
          if (taskChannelUniqueName === 'channel')
            return {
              fetch: async () => ({ availableCapacityPercentage: 1, configuredCapacity: 2 }),
            };

          if (taskChannelUniqueName === 'channel2')
            return {
              fetch: async () => ({ availableCapacityPercentage: 0, configuredCapacity: 1 }),
            };

          throw new Error('Channel does not exists');
        },
      };
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
        if (serviceSid === baseContext.CHAT_SERVICE_SID)
          return {
            channels: (channelSid: string) => {
              if (channels[channelSid])
                return {
                  members: (memberSid: string) => {
                    if (channels[channelSid].includes(memberSid))
                      return {
                        remove: async () => {
                          channels[channelSid] = channels[channelSid].filter(v => v !== memberSid);
                          return true;
                        },
                      };

                    throw new Error('Member is not participant');
                  },
                };

              throw new Error('Error retrieving chat channel');
            },
          };

        throw new Error('Error retrieving chat service');
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  TWILIO_WORKSPACE_SID: 'WSxxx',
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: 'WWxxx',
  CHAT_SERVICE_SID: 'ISxxx',
};

beforeAll(() => {
  helpers.setup({});
});
afterAll(() => {
  helpers.teardown();
});

beforeEach(() => {
  channels.channel = ['worker1'];
});

afterEach(() => {
  if (tasks.length > 2) tasks = tasks.slice(0, 2);
});

describe('transferChatStart (with maxMessageCapacity set)', () => {
  test('Should return status 400', async () => {
    const event1: Body = {
      taskSid: undefined,
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
    };
    const event2: Body = {
      taskSid: 'task1',
      targetSid: undefined,
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
    };
    const event3: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: undefined,
      mode: 'COLD',
      memberToKick: 'worker1',
    };
    const event4: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: undefined,
      memberToKick: 'worker1',
    };
    const event5: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [{}, event1, event2, event3, event4, event5].map(event =>
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
      memberToKick: 'worker1',
    };

    const event2: Body = {
      taskSid: 'task2',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
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
      memberToKick: 'worker1',
    };

    const event2: Body = {
      taskSid: 'non existing',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
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
      expect(response.getBody().toString()).toContain('Task does not exists');
    };

    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    await transferChatStart({ getTwilioClient, DOMAIN_NAME }, event1, callback1);
    await transferChatStart(baseContext, event2, callback2);
  });

  test('Should return status 200 (WARM)', async () => {
    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'WARM',
      memberToKick: 'worker1',
    };
    const before = Array.from(tasks);
    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find(t => t.sid === 'task1');
      const newTask = tasks.find(t => t.sid === 'newTaskSid');

      const expectedNewAttr =
        '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask).toStrictEqual(before[0]);
      expect(tasks).toHaveLength(3);
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
    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
    };
    const expectedOldAttr =
      '{"channelSid":"CH00000000000000000000000000000000","proxySessionSID":"KC00000000000000000000000000000000"}';
    const expectedNewAttr =
      '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find(t => t.sid === 'task1');
      const newTask = tasks.find(t => t.sid === 'newTaskSid');

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask.attributes).toBe(expectedOldAttr);
      expect(originalTask.reason).toBe('task transferred');
      expect(originalTask.assignmentStatus).toBe('wrapping');
      expect(tasks).toHaveLength(3);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
      expect(channels.channel).not.toContain('worker1');
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
      memberToKick: 'worker1',
    };

    const event2: Body = {
      taskSid: 'task2',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
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
      assignmentStatus: undefined,
      reason: undefined,
    });

    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      ignoreAgent: 'worker1',
      mode: 'COLD',
      memberToKick: 'worker1',
    };
    const expectedOldAttr =
      '{"channelSid":"CH00000000000000000000000000000000","proxySessionSID":"KC00000000000000000000000000000000"}';
    const expectedNewAttr =
      '{"channelSid":"channel","conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find(t => t.sid === 'task1');
      const newTask = tasks.find(t => t.sid === 'newTaskSid');

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      console.log(response);
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask.attributes).toBe(expectedOldAttr);
      expect(originalTask.reason).toBe('task transferred');
      expect(originalTask.assignmentStatus).toBe('wrapping');
      expect(tasks).toHaveLength(3);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
      expect(channels.channel).not.toContain('worker1');
      expect(channels.channel).toContain('worker2');
    };

    await transferChatStart(baseContext, event, callback);
  });
});
