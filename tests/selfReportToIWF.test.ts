/* eslint-disable no-var */
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import { omit } from 'lodash';
import {
  handler as selfReportToIWF,
  Body,
  IWFSelfReportPayload,
  formData,
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
  AS_DEV_IWF_API_CASE_URL: 'AS_DEV_IWF_API_CASE_URL',
  AS_DEV_IWF_REPORT_URL: 'AS_DEV_IWF_REPORT_URL',
  AS_DEV_IWF_SECRET_KEY: 'AS_DEV_IWF_SECRET_KEY',
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

  test('Should return status 400 if value is undefined', async () => {
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

  test('Should return status 500 if data is undefined', async () => {
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

  test('Should POST a payload to AS_DEV_IWF_API_CASE_URL and return 200', async () => {
    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    const body: IWFSelfReportPayload = {
      case_number: 'case_number',
      secret_key: 'secret_key',
      user_age_range: '<13',
    };

    formData.append('secret_key', body.secret_key);
    formData.append('case_number', body.case_number);
    formData.append('user_age_range', body.user_age_range);

    await selfReportToIWF({ ...baseContext }, event, () => {});

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.AS_DEV_IWF_API_CASE_URL,
        method: 'POST',
        data: formData,
      }),
    );

    expect(defaultPayload).toMatchObject({
      ...omit(event, 'request'),
      case_number: 'case_number',
      secret_key: 'secret_key',
      user_age_range: '<13',
    });
  });

  test('Environment variables should override default values in POST', async () => {
    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    const body: IWFSelfReportPayload = {
      case_number: 'case_number',
      secret_key: 'secret_key',
      user_age_range: '<13',
    };

    formData.append('secret_key', body.secret_key);
    formData.append('case_number', body.case_number);
    formData.append('user_age_range', body.user_age_range);

    await selfReportToIWF(
      {
        ...baseContext,
        AS_DEV_IWF_API_CASE_URL: 'AS_DEV_IWF_API_CASE_URL',
        AS_DEV_IWF_REPORT_URL: 'AS_DEV_IWF_REPORT_URL',
        AS_DEV_IWF_SECRET_KEY: 'AS_DEV_IWF_SECRET_KEY',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.AS_DEV_IWF_API_CASE_URL,
        method: 'POST',
        data: formData,
      }),
    );
  });
});
