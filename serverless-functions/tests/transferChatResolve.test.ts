import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as transferChatResolve, Body } from '../functions/transferChatResolve';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

let tasks: any[] = [];
const channels: { [x: string]: string[] } = {};

const createTask = (taskSid: string, worker: string, channel: string = 'channel') => {
  tasks.push({
    sid: taskSid,
    taskChannelUniqueName: channel,
    attributes: `{"channelSid":"${channel}"}`,
    fetch: async () => tasks.find((t) => t.sid === taskSid),
    update: async ({
      attributes,
      assignmentStatus,
      reason,
    }: {
      attributes: string;
      assignmentStatus: string;
      reason: string;
    }) => {
      const task = tasks.find((t) => t.sid === taskSid);
      tasks = tasks.map((t) => {
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
  });

  if (channels[channel] === undefined) channels[channel] = [worker];
  else channels[channel].push(worker);
};

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: (taskSid: string) => {
      const task = tasks.find((t) => t.sid === taskSid);
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
                          channels[channelSid] = channels[channelSid].filter(
                            (v) => v !== memberSid,
                          );
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
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('transferChatResolve', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  beforeEach(() => {
    tasks = [];
    channels.channel = [];
    createTask('task1', 'worker1');
    createTask('task2', 'worker2');
  });

  test('Should return status 400', async () => {
    const event0 = { request: { cookies: {}, headers: {} } };
    const event1: Body = {
      closeSid: undefined,
      keepSid: 'task2',
      memberToKick: 'worker1',
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };
    const event2: Body = {
      closeSid: 'task1',
      keepSid: undefined,
      memberToKick: 'worker1',
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };
    const event3: Body = {
      closeSid: 'task1',
      keepSid: 'task2',
      memberToKick: undefined,
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };
    const event4: Body = {
      closeSid: 'task1',
      keepSid: 'task2',
      memberToKick: 'worker1',
      newStatus: undefined,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [event0, event1, event2, event3, event4].map((event) =>
        transferChatResolve(baseContext, event, callback),
      ),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      closeSid: 'non existing',
      keepSid: 'task2',
      memberToKick: '',
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };
    const event2: Body = {
      closeSid: 'task1',
      keepSid: 'non existing',
      memberToKick: '',
      newStatus: 'accepted',
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
    await transferChatResolve(payload, event1, callback1);
    await transferChatResolve(baseContext, event1, callback2);
    await transferChatResolve(baseContext, event2, callback2);
  });

  test('Should return status 200 (close original)', async () => {
    const event: Body = {
      closeSid: 'task1',
      keepSid: 'task2',
      memberToKick: 'worker1',
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };

    const expected = { closed: 'task1', kept: 'task2' };
    const expectedClosedAttr = {
      channelSid: 'CH00000000000000000000000000000000',
      proxySessionSID: 'KC00000000000000000000000000000000',
      transferMeta: { transferStatus: 'accepted' },
    };
    const expectedKeptAttr = {
      channelSid: 'channel',
      transferMeta: { transferStatus: 'accepted' },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);

      const { closed, kept } = response.getBody();
      const closedTask = tasks.find((t) => t.sid === closed);
      const keptTask = tasks.find((t) => t.sid === kept);

      expect(closedTask.assignmentStatus).toBe('wrapping');
      expect(closedTask.reason).toBe('task transferred');
      expect(JSON.parse(closedTask.attributes)).toStrictEqual(expectedClosedAttr);
      expect(JSON.parse(keptTask.attributes)).toStrictEqual(expectedKeptAttr);
    };

    await transferChatResolve(baseContext, event, callback);
  });

  test('Should return status 200 (close transferred)', async () => {
    const event: Body = {
      closeSid: 'task2',
      keepSid: 'task1',
      memberToKick: 'worker1',
      newStatus: 'accepted',
      request: { cookies: {}, headers: {} },
    };

    const expected = { closed: 'task2', kept: 'task1' };
    const expectedClosedAttr = {
      channelSid: 'CH00000000000000000000000000000000',
      proxySessionSID: 'KC00000000000000000000000000000000',
      transferMeta: { transferStatus: 'accepted' },
    };
    const expectedKeptAttr = {
      channelSid: 'channel',
      transferMeta: { transferStatus: 'accepted' },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toStrictEqual(expected);

      const { closed, kept } = response.getBody();
      const closedTask = tasks.find((t) => t.sid === closed);
      const keptTask = tasks.find((t) => t.sid === kept);

      expect(closedTask.assignmentStatus).toBe('wrapping');
      expect(closedTask.reason).toBe('task transferred');
      expect(JSON.parse(closedTask.attributes)).toStrictEqual(expectedClosedAttr);
      expect(JSON.parse(keptTask.attributes)).toStrictEqual(expectedKeptAttr);
    };

    await transferChatResolve(baseContext, event, callback);
  });
});
