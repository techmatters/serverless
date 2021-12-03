import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as populateCounselors, Body } from '../functions/populateCounselors';

import helpers, { MockedResponse } from './helpers';

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
  getTwilioClient: (): any => ({
    taskrouter: {
      workspaces: (workspaceSID: string) => {
        if (workspaces[workspaceSID]) return workspaces[workspaceSID];

        throw new Error('Workspace does not exists');
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
};

describe('populateCounselors', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const event: Body = { workspaceSID: undefined };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await populateCounselors(baseContext, {}, callback);
    await populateCounselors(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    const event: Body = { workspaceSID: 'non-existing' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Workspace does not exists');
    };

    await populateCounselors(baseContext, event, callback);
  });

  test('Should return status 200 (no helpline filter)', async () => {
    const event1: Body = { workspaceSID: 'WSxxx' };
    const event2: Body = { workspaceSID: 'WSxxx', helpline: '' };

    const expected = [1, 2, 3, 4].map(n => ({ fullName: `worker${n}`, sid: `worker${n}` }));

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      const { workerSummaries } = response.getBody();
      expect(workerSummaries).toHaveLength(4);
      expect(workerSummaries).toStrictEqual(expected);
    };

    await Promise.all(
      [event1, event2].map(event => populateCounselors(baseContext, event, callback)),
    );
  });

  test('Should return status 200 (with helpline filter)', async () => {
    const event: Body = { workspaceSID: 'WSxxx', helpline: 'helpline1' };

    const expected = [1, 2, 3].map(n => ({ fullName: `worker${n}`, sid: `worker${n}` }));

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
