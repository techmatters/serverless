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
import { handler as populateCounselors, Body } from '../functions/populateCounselors';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const workers = [
  {
    sid: 'worker1',
    attributes: JSON.stringify({
      full_name: 'worker1',
      helpline: '',
    }),
  },
  {
    sid: 'worker2',
    attributes: JSON.stringify({
      full_name: 'worker2',
    }),
  },
  {
    sid: 'worker3',
    attributes: JSON.stringify({
      full_name: 'worker3',
      helpline: 'helpline1',
    }),
  },
  {
    sid: 'worker4',
    attributes: JSON.stringify({
      full_name: 'worker4',
      helpline: 'helpline2',
    }),
  },
];

const wsxxx = {
  workers: () => ({
    list: async () => workers,
  }),
};

const workspaces: { [x: string]: any } = {
  WSxxx: {
    fetch: async () => wsxxx,
  },
};

const baseContext = {
  getTwilioClient: (() => ({
    taskrouter: {
      workspaces: (workspaceSID: string) => {
        if (workspaces[workspaceSID]) return workspaces[workspaceSID];

        throw new Error('Workspace does not exists');
      },
    },
  })) as any,
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('populateCounselors', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const event: Body = { workspaceSID: undefined, request: { cookies: {}, headers: {} } };
    const emptyEvent = { request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await populateCounselors(baseContext, emptyEvent, callback);
    await populateCounselors(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    const event: Body = { workspaceSID: 'non-existing', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Workspace does not exists');
    };

    await populateCounselors(baseContext, event, callback);
  });

  test('Should return status 200 (no helpline filter)', async () => {
    const event1: Body = { workspaceSID: 'WSxxx', request: { cookies: {}, headers: {} } };
    const event2: Body = {
      workspaceSID: 'WSxxx',
      helpline: '',
      request: { cookies: {}, headers: {} },
    };

    const expected = [1, 2, 3, 4].map((n) => ({ fullName: `worker${n}`, sid: `worker${n}` }));

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      const { workerSummaries } = response.getBody();
      expect(workerSummaries).toHaveLength(4);
      expect(workerSummaries).toStrictEqual(expected);
    };

    await Promise.all(
      [event1, event2].map((event) => populateCounselors(baseContext, event, callback)),
    );
  });

  test('Should return status 200 (with helpline filter)', async () => {
    const event: Body = {
      workspaceSID: 'WSxxx',
      helpline: 'helpline1',
      request: { cookies: {}, headers: {} },
    };

    const expected = [1, 2, 3].map((n) => ({ fullName: `worker${n}`, sid: `worker${n}` }));

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      const { workerSummaries } = response.getBody();
      expect(workerSummaries).toHaveLength(3);
      expect(workerSummaries).toStrictEqual(expected);
    };

    await populateCounselors(baseContext, event, callback);
  });
});
