import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import each from 'jest-each';

import { handler as sendSystemMessage, Body } from '../functions/sendSystemMessage';
import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const tasks: any[] = [
  {
    sid: 'task-123',
    attributes: '{"channelSid":"channel-123"}',
    fetch: async () => tasks.find((t) => t.sid === 'task-123'),
  },
  {
    sid: 'broken-task',
    attributes: '{"channelSid":"non-existing"}',
    fetch: async () => tasks.find((t) => t.sid === 'broken-task'),
  },
];

const createMessageMock = jest.fn();
const channels: { [x: string]: any } = {
  'channel-123': { messages: { create: createMessageMock } },
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
              if (channels[channelSid]) return channels[channelSid];

              throw new Error('Error retrieving chat channel');
            },
          };

        throw new Error('Error retrieving chat service');
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  TWILIO_WORKSPACE_SID: 'WSxxx',
  CHAT_SERVICE_SID: 'ISxxx',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
  ACCOUNT_SID: 'ACCOUNT_SID, AUTH_TOKEN',
  AUTH_TOKEN: 'ACCOUNT_SID, AUTH_TOKEN',
};

describe('sendSystemMessage', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  each([
    {
      event: { request: { cookies: {}, headers: {} } },
      reason: 'none of channelSid or taskSid provided',
    },
    {
      event: {
        taskSid: 'task-123',
        message: undefined,
        request: { cookies: {}, headers: {} },
      },
      reason: 'taskSid provided but missing message',
    },
    {
      event: {
        channelSid: 'channel-123',
        message: undefined,
        request: { cookies: {}, headers: {} },
      },
      reason: 'channelSid provided but missing message',
    },
  ]).test('Should return status 400: $reason', async ({ event }) => {
    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await sendSystemMessage(baseContext, event, callback);
  });

  each([
    {
      event: {
        taskSid: 'task-123',
        message: 'Something to say',
        request: { cookies: {}, headers: {} },
      },
      expectedMessage: 'Workspace does not exists',
      context: {
        ...baseContext,
        TWILIO_WORKSPACE_SID: null,
      },
    },
    {
      event: {
        taskSid: 'non-existing',
        message: 'Something to say',
        request: { cookies: {}, headers: {} },
      },
      expectedMessage: 'Task does not exists',
    },
    {
      event: {
        taskSid: 'broken-task',
        message: 'Something to say',
        request: { cookies: {}, headers: {} },
      },
      expectedMessage: 'Error retrieving chat channel',
    },
  ]).test(
    'Should return status 500: $expectedMessage',
    async ({ event, expectedMessage, context }) => {
      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(500);
        expect(response.getBody().message).toContain(expectedMessage);
      };

      await sendSystemMessage(context ?? baseContext, event, callback);
    },
  );

  each([
    {
      event: {
        taskSid: 'task-123',
        message: 'Something to say',
        from: 'someone',
        request: { cookies: {}, headers: {} },
      },
      condition: 'taskSid provided',
    },
    {
      event: {
        channelSid: 'channel-123',
        message: 'Something to say',
        from: 'someother',
        request: { cookies: {}, headers: {} },
      },
      condition: 'channelSid provided',
    },
  ]).test('Should return status 200: $condition', async ({ event }) => {
    const callback = jest.fn();

    expect(createMessageMock).not.toHaveBeenCalled();
    await sendSystemMessage(baseContext, event, callback);

    expect(callback.mock.results).toHaveLength(1);
    expect(callback.mock.results[0].type).toBe('return');

    const result = callback.mock.lastCall[1];
    console.log(result);
    expect(result).toBeDefined();
    const response = result as MockedResponse;
    expect(response.getStatus()).toBe(200);
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: event.message,
        from: event.from,
        xTwilioWebhookEnabled: 'true',
      }),
    );
  });
});
