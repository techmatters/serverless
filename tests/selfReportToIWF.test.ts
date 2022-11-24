import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import { omit } from 'lodash';
import {
  handler as selfReportToIWF,
  Body,
  IWFSelfReportPayload,
} from '../functions/selfReportToIWF';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

jest.mock('axios');

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  IWF_API_CASE_URL: 'IWF_API_CASE_URL',
  IWF_REPORT_URL: 'IWF_REPORT_URL',
  IWF_SECRET_KEY: 'IWF_SECRET_KEY',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const defaultPayload = {
  secret_key: 'secret_key',
  case_number: 'case_number',
  user_age_range: '<13',
};

describe('selfReportToIWF', () => {
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

  test('Should return status 400', async () => {
    const event: Body = {
      user_age_range: undefined,
      request: { cookies: {}, headers: {} },
    };

    const emptyEvent = {
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };
    await selfReportToIWF(baseContext, event, callback);
    await selfReportToIWF(baseContext, emptyEvent, callback);
  });

  test('Should return status 500', async () => {
    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('undefined');
    };

    await selfReportToIWF(baseContext, event, callback);
  });

  test('Should POST a payload to IWF_API_CASE_URL and return 200', async () => {
    let postedPayload: IWFSelfReportPayload | undefined;
    // @ts-ignore
    axios.mockImplementationOnce((request) => {
      postedPayload = JSON.parse(request.data);
      return Promise.resolve({
        status: 200,
        data: 'Returned ok',
      });
    });

    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    await selfReportToIWF(
      {
        ...baseContext,
        IWF_API_CASE_URL: 'IWF_API_CASE_URL',
        IWF_REPORT_URL: 'IWF_REPORT_URL',
        IWF_SECRET_KEY: 'IWF_SECRET_KEY',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_CASE_URL,
        method: 'POST',
        data: expect.anything(),
      }),
    );

    expect(postedPayload).toMatchObject({
      ...defaultPayload,
      ...omit(event, 'request'),
      secret_key: 'IWF_SECRET_KEY',
      case_number: postedPayload?.case_number,
      user_age_range: '13-15',
    });
  });

  test('Environment variables should override default values in POST', async () => {
    let postedPayload: IWFSelfReportPayload | undefined;
    // @ts-ignore
    axios.mockImplementationOnce((request) => {
      postedPayload = JSON.parse(request.data);
      return Promise.resolve({
        status: 200,
        data: 'Returned ok',
      });
    });

    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    await selfReportToIWF(
      {
        ...baseContext,
        IWF_API_CASE_URL: 'IWF_API_CASE_URL',
        IWF_REPORT_URL: 'IWF_REPORT_URL',
        IWF_SECRET_KEY: 'IWF_SECRET_KEY',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_CASE_URL,
        method: 'POST',
        data: expect.anything(),
      }),
    );

    expect(postedPayload).toMatchObject({
      ...defaultPayload,
      secret_key: 'IWF_SECRET_KEY',
      case_number: postedPayload?.case_number,
      user_age_range: '13-15',
    });
  });
});
