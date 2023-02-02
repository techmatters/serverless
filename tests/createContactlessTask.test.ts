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
import { handler as createContactlessTask, Body } from '../functions/createContactlessTask';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

let tasks: any[] = [];

const workspaces: { [x: string]: any } = {
  WSxxx: {
    tasks: {
      create: async (options: any) => {
        if (JSON.parse(options.attributes).helpline === 'intentionallyThrow')
          throw new Error('Intentionally thrown error');

        tasks = [...tasks, { sid: Math.random(), ...options }];
      },
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

afterEach(() => {
  tasks = [];
});

describe('createContactlessTask', () => {
  test('Should return status 400', async () => {
    const bad1: Body = {
      targetSid: undefined,
      transferTargetType: 'worker',
      helpline: 'helpline',
      request: { cookies: {}, headers: {} },
    };
    const bad2: Body = {
      targetSid: 'WKxxx',
      transferTargetType: undefined,
      helpline: 'helpline',
      request: { cookies: {}, headers: {} },
    };
    const bad3: Body = {
      targetSid: 'WKxxx',
      transferTargetType: 'worker',
      helpline: undefined,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await Promise.all(
      [bad1, bad2, bad3].map((event) => createContactlessTask(baseContext, event, callback)),
    );
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      targetSid: 'WKxxx',
      transferTargetType: 'worker',
      helpline: 'helpline',
      request: { cookies: {}, headers: {} },
    };

    const event2: Body = {
      targetSid: 'WKxxx',
      transferTargetType: 'worker',
      helpline: 'intentionallyThrow',
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
      expect(response.getBody().message).toContain('Intentionally thrown error');
    };

    const { getTwilioClient, DOMAIN_NAME } = baseContext;
    const payload: any = { getTwilioClient, DOMAIN_NAME };
    await createContactlessTask(payload, event1, callback1);
    await createContactlessTask(baseContext, event2, callback2);
  });

  test('Should return status 200 (WARM)', async () => {
    const event: Body = {
      targetSid: 'WKxxx',
      transferTargetType: 'worker',
      helpline: 'helpline',
      request: { cookies: {}, headers: {} },
    };
    const beforeTasks = Array.from(tasks);

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(beforeTasks).toHaveLength(0);
      expect(tasks).toHaveLength(1);
    };

    await createContactlessTask(baseContext, event, callback);
  });
});
