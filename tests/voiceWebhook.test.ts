import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as voiceWebhook, Body } from '../functions/voiceWebhook.protected';

import helpers, { MockedResponse } from './helpers';

let tasks: any[] = [
  {
    sid: 'task-sid-1',
    taskChannelUniqueName: 'voice',
    attributes: '{"from":"+123456"}',
    fetch: async () => tasks.find(t => t.sid === 'task-sid-1'),
    update: async ({ attributes }: { attributes: string }) => {
      const task = tasks.find(t => t.sid === 'task-sid-1');
      const updatedTask = { ...task, attributes };
      tasks = tasks.map(t => {
        if (t.sid === task.sid) {
          return updatedTask;
        }
        return t;
      });

      return Promise.resolve(updatedTask);
    },
  },
  {
    sid: 'task-sid-2',
    taskChannelUniqueName: 'whatsapp',
    attributes: '{"from":"+999999"}',
    fetch: async () => tasks.find(t => t.sid === 'task-sid-2'),
    update: async ({ attributes }: { attributes: string }) => {
      const task = tasks.find(t => t.sid === 'task-sid-2');
      const updatedTask = { ...task, attributes };
      tasks = tasks.map(t => {
        if (t.sid === task.sid) {
          return updatedTask;
        }
        return t;
      });

      return Promise.resolve(updatedTask);
    },
  },
];

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find(t => t.sid === taskSid);
      if (task) return task;

      throw new Error(`Task ${taskSid} does not exists`);
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

beforeAll(() => {
  helpers.setup({});
});
afterAll(() => {
  helpers.teardown();
});

describe('voiceWebhook', () => {
  test('Should change task.attributes.from when voice channel', async () => {
    const event: Body = {
      EventType: 'task.created',
      TaskSid: 'task-sid-1',
      TaskChannelUniqueName: 'voice',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();

      const response = result as MockedResponse;
      const updatedTask = response.getBody();
      const { sid, attributes } = updatedTask;
      const { from } = JSON.parse(attributes);

      expect(response.getStatus()).toBe(200);
      expect(sid).toEqual(event.TaskSid);
      expect(from).toEqual(`+123456_${event.TaskSid}`);
    };

    await voiceWebhook(baseContext, event, callback);
  });

  test('Should not change task.attributes.from when not voice channel', async () => {
    const event: Body = {
      EventType: 'task.created',
      TaskSid: 'task-sid-2',
      TaskChannelUniqueName: 'whatsapp',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();

      const response = result as MockedResponse;

      expect(response.getStatus()).toBe(200);
      expect(response.getBody().toString()).toContain('Is not a new voice task');
    };

    await voiceWebhook(baseContext, event, callback);
  });
});
