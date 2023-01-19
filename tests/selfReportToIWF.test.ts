/* eslint-disable no-var */
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios, { AxiosRequestConfig } from 'axios';
import * as https from 'https';
import {
  Body,
  handler as selfReportToIWF,
  IWFSelfReportPayload,
} from '../functions/selfReportToIWF';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

jest.mock('axios');
jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => {
    const data: Record<string, any> = {
      getHeaders: () => ({ 'Content-Type': 'multi-part/form' }),
    };
    data.append = (key: string, value: string) => {
      data[key] = value;
    };
    return data;
  });
});

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  IWF_API_CASE_URL: 'TEST_IWF_API_CASE_URL',
  IWF_REPORT_URL: 'TEST_IWF_REPORT_URL',
  IWF_SECRET_KEY: 'TEST_IWF_SECRET_KEY',
  IWF_REPORT_SELF_SIGNED: '',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
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

  test('Should return status 400 if value is undefined', async () => {
    const event: Body = {
      user_age_range: undefined,
      case_number: 'case_number',
      request: { cookies: {}, headers: {} },
    };

    const emptyEvent = {
      case_number: undefined,
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

  test('Should return status 500 if data is undefined', async () => {
    const event: Body = {
      user_age_range: '13-15',
      case_number: 'case_number',
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

  test('Should POST a payload to TEST_IWF_API_CASE_URL and return 200', async () => {
    const event: Body = {
      user_age_range: '<13',
      case_number: 'case_number',
      request: { cookies: {}, headers: {} },
    };

    const expectedFormData: IWFSelfReportPayload = {
      case_number: 'case_number',
      secret_key: 'TEST_IWF_SECRET_KEY',
      user_age_range: '<13',
    };

    await selfReportToIWF({ ...baseContext }, event, () => {});

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_CASE_URL,
        method: 'POST',
        data: expect.objectContaining(expectedFormData),
      }),
    );

    const iwfPayload = (axios as unknown as jest.Mock).mock.calls[0][0] as AxiosRequestConfig;
    // Can be removed once we deprecate the temporary 'allow self signed option'
    expect(iwfPayload.httpsAgent).not.toBeDefined();
  });

  test('Should set https axios property if self signed set to true', async () => {
    const event: Body = {
      user_age_range: '13-15',
      case_number: 'case_number',
      request: { cookies: {}, headers: {} },
    };

    await selfReportToIWF({ ...baseContext, IWF_REPORT_SELF_SIGNED: 'true' }, event, () => {});

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        httpsAgent: expect.any(https.Agent),
      }),
    );
    const iwfPayload = (axios as unknown as jest.Mock).mock.calls[0][0] as AxiosRequestConfig;
    expect((iwfPayload.httpsAgent as https.Agent).options.rejectUnauthorized).toBe(false);
  });

  test('Environment variables should override default values in POST', async () => {
    const event: Body = {
      user_age_range: '13-15',
      case_number: 'case_number',
      request: { cookies: {}, headers: {} },
    };

    const expectedFormData: IWFSelfReportPayload = {
      case_number: 'case_number',
      secret_key: 'TEST_IWF_SECRET_KEY',
      user_age_range: '13-15',
    };

    await selfReportToIWF(
      {
        ...baseContext,
        IWF_API_CASE_URL: 'TEST_IWF_API_CASE_URL',
        IWF_REPORT_URL: 'TEST_IWF_REPORT_URL',
        IWF_SECRET_KEY: 'TEST_IWF_SECRET_KEY',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_CASE_URL,
        method: 'POST',
        data: expect.objectContaining(expectedFormData),
      }),
    );
  });
});
