import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import MockDate from 'mockdate';
import { handler as operatingHours, Body } from '../functions/operatingHours';

import helpers, { MockedResponse } from './helpers';

// I use a timestamp to make sure the date stays fixed to the ms

const baseContext = {
  getTwilioClient: jest.fn(),
  DOMAIN_NAME: 'serverless',
  OPERATING_INFO_KEY: 'test',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const testday = 1617911935784; // timeOfDay: 21:58, dayOfWeek: 4, currentDate: '04/08/2021'
const holiday = testday + 86400000; // timeOfDay: 21:58, dayOfWeek: 5, currentDate: '04/09/2021'
const sunday = testday + 86400000 * 3; // timeOfDay: 21:58, dayOfWeek: 7, currentDate: '04/11/2021'

describe('operatingHours', () => {
  beforeAll(() => {
    MockDate.set(testday);
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    runtime._addAsset('/operatingInfo/test.json', './test.operatingHours.json');
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
    MockDate.reset();
  });

  test('Should return status 400', async () => {
    const event: Body = { channel: undefined };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await operatingHours(baseContext, {}, callback);
    await operatingHours(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    const event1: Body = { channel: 'non-existing' };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('OPERATING_INFO_KEY env var not provided.');
    };

    const event2: Body = { channel: 'non-existing' };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'Operating Info not found for channel non-existing. Check OPERATING_INFO_KEY env vars and a matching OperatingInfo json file for it.',
      );
    };

    // @ts-ignore
    await operatingHours({ ...baseContext, OPERATING_INFO_KEY: undefined }, event1, callback1);
    await operatingHours(baseContext, event2, callback2);
  });

  describe('Should return status 200 (without office)', () => {
    test('open', async () => {
      const event: Body = { channel: 'webchat' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('open');
      };

      await operatingHours(baseContext, event, callback);
    });

    test('closed with shifts', async () => {
      const event: Body = { channel: 'facebook' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
      };

      await operatingHours(baseContext, event, callback);
    });

    test('closed without shifts', async () => {
      const event: Body = { channel: 'another' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
      };

      await operatingHours(baseContext, event, callback);
    });

    test('holiday', async () => {
      MockDate.set(holiday);

      const event: Body = { channel: 'webchat' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('holiday');
      };

      await operatingHours(baseContext, event, callback);

      MockDate.set(testday);
    });

    test('sunday-closed', async () => {
      MockDate.set(sunday);

      const event: Body = { channel: 'facebook' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
      };

      await operatingHours(baseContext, event, callback);

      MockDate.set(testday);
    });
  });

  describe('Should return status 200 (with office)', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    test('open', async () => {
      const event: Body = { channel: 'webchat', office: 'office1' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('open');
      };

      await operatingHours(baseContext, event, callback);
    });

    test('closed with shifts', async () => {
      const event: Body = { channel: 'facebook', office: 'office1' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
      };

      await operatingHours(baseContext, event, callback);
    });

    test('missing channel in office entry, defaults to root (closed without shifts)', async () => {
      const event: Body = { channel: 'another', office: 'office1' };

      const spyError = jest.spyOn(console, 'error');

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
        expect(spyError).toBeCalledTimes(1);
      };

      await operatingHours(baseContext, event, callback);
    });

    test('holiday', async () => {
      MockDate.set(holiday);

      const event: Body = { channel: 'webchat', office: 'office1' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('holiday');
      };

      await operatingHours(baseContext, event, callback);

      MockDate.set(testday);
    });

    test('sunday-closed', async () => {
      MockDate.set(sunday);

      const event: Body = { channel: 'facebook', office: 'office1' };

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('closed');
      };

      await operatingHours(baseContext, event, callback);

      MockDate.set(testday);
    });

    test('missing office entry, defaults to root (open)', async () => {
      const event: Body = { channel: 'webchat', office: 'non-existing' };

      const spyError = jest.spyOn(console, 'error');

      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        console.log('>>>>>>', response.getBody());
        expect(response.getStatus()).toBe(200);
        expect(response.getBody()).toContain('open');
        expect(spyError).toBeCalledTimes(1);
      };

      await operatingHours(baseContext, event, callback);
    });
  });
});
