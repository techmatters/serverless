import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as transferChatStart, Body } from '../functions/transferChatStart';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [
  {
    sid: 'task1',
    taskChannelUniqueName: 'channel',
    attributes: '{}',
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
];

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find(t => t.sid === taskSid);
      if (task) return task;

      throw new Error('Task does not exists');
    },
  },
};

workspaces.WSxxx.tasks.create = async (options: any) => {
  const newTask = {
    ...options,
    sid: 'newTaskSid',
  };
  tasks.push(newTask);
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
  }),
  DOMAIN_NAME: 'serverless',
  TWILIO_WORKSPACE_SID: 'WSxxx',
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: 'WWxxx',
};

describe('transferChatStart', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  afterEach(() => {
    if (tasks.length > 1) tasks = tasks.slice(0, 1);
  });

  test('Should return status 400', async () => {
    const event1: Body = {
      taskSid: undefined,
      targetSid: 'WKxxx',
      workerName: 'worker1',
      mode: 'COLD',
    };
    const event2: Body = {
      taskSid: 'task1',
      targetSid: undefined,
      workerName: 'worker1',
      mode: 'COLD',
    };
    const event3: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      workerName: undefined,
      mode: 'COLD',
    };
    const event4: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      workerName: 'worker1',
      mode: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [{}, event1, event2, event3, event4].map(event =>
        transferChatStart(baseContext, event, callback),
      ),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      workerName: 'worker1',
      mode: 'COLD',
    };

    const event2: Body = {
      taskSid: 'non existing',
      targetSid: 'WKxxx',
      workerName: 'worker1',
      mode: 'COLD',
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
      workerName: 'worker1',
      mode: 'WARM',
    };
    const before = Array.from(tasks);
    const expected = { taskSid: 'newTaskSid' };

    const callback: ServerlessCallback = (err, result) => {
      const originalTask = tasks.find(t => t.sid === 'task1');
      const newTask = tasks.find(t => t.sid === 'newTaskSid');

      const expectedNewAttr =
        '{"conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);
      expect(originalTask).toStrictEqual(before[0]);
      expect(tasks).toHaveLength(2);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
    };

    await transferChatStart(baseContext, event, callback);
  });

  test('Should return status 200 (COLD)', async () => {
    const event: Body = {
      taskSid: 'task1',
      targetSid: 'WKxxx',
      workerName: 'worker1',
      mode: 'COLD',
    };
    const expectedOldAttr =
      '{"channelSid":"CH00000000000000000000000000000000","proxySessionSID":"KC00000000000000000000000000000000"}';
    const expectedNewAttr =
      '{"conversations":{"conversation_id":"task1"},"ignoreAgent":"worker1","targetSid":"WKxxx","transferTargetType":"worker"}';

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
      expect(originalTask.assignmentStatus).toBe('completed');
      expect(tasks).toHaveLength(2);
      expect(newTask).toHaveProperty('sid');
      expect(newTask.taskChannel).toBe(originalTask.taskChannelUniqueName);
      expect(newTask.wokflowSid).toBe(originalTask.wokflowSid);
      expect(newTask.attributes).toBe(expectedNewAttr);
    };

    await transferChatStart(baseContext, event, callback);
  });
});
