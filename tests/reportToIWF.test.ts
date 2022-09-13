import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import { omit } from 'lodash';
import { handler as reportToIWF, Event as Body, IWFReportPayload } from '../functions/reportToIWF';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

jest.mock('axios');

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  IWF_API_USERNAME: 'IWF_API_USERNAME',
  IWF_API_PASSWORD: 'IWF_API_PASSWORD',
  IWF_API_URL: 'IWF_API_URL',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const defaultPayload = {
  Reporting_Type: 'R',
  Live_Report: 'T',
  Media_Type_ID: 1,
  Report_Channel_ID: 51,
  Origin_ID: 5,
  Submission_Type_ID: 1,
  Reported_Category_ID: 2,
  Reported_URL: 'Reported_URL',
  Reporter_Anonymous: 'Y',
  Reporter_First_Name: null,
  Reporter_Last_Name: null,
  Reporter_Email_ID: null,
  Reporter_Description: null,
  Reporter_Country_ID: null,
};

describe('reportToIWF', () => {
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
    const event1: Body = {
      Reported_URL: undefined,
      Reporter_Anonymous: 'Y',
      request: { cookies: {}, headers: {} },
    };
    const event2: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: undefined,
      request: { cookies: {}, headers: {} },
    };
    const event3: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Other',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await reportToIWF(baseContext, event1, callback);
    await reportToIWF(baseContext, event2, callback);
    await reportToIWF(baseContext, event3, callback);
  });

  test('Should return status 500', async () => {
    jest.spyOn(Buffer, 'from').mockImplementationOnce(() => {
      throw new Error('Boom!');
    });

    const event: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Y',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain('Boom!');
    };

    await reportToIWF(baseContext, event, callback);
  });

  test('Should POST a payload to IWF_API_URL and return 200', async () => {
    let postedPayload: IWFReportPayload | undefined;
    // @ts-ignore
    axios.mockImplementationOnce((request) => {
      postedPayload = JSON.parse(request.data);
      return Promise.resolve({
        status: 200,
        data: 'Returned ok',
      });
    });

    const event: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Y',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody().toString()).toContain('Returned ok');
    };

    await reportToIWF(baseContext, event, callback);

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_URL,
        method: 'POST',
        data: expect.anything(),
      }),
    );
    expect(postedPayload).toMatchObject(defaultPayload);
  });

  test('Extra report details should be copied into POST payload', async () => {
    let postedPayload: IWFReportPayload | undefined;
    // @ts-ignore
    axios.mockImplementationOnce((request) => {
      postedPayload = JSON.parse(request.data);
      return Promise.resolve({
        status: 200,
        data: 'Returned ok',
      });
    });

    const event: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Y',
      Reporter_First_Name: 'Lorna',
      Reporter_Last_Name: 'Ballantyne',
      Reporter_Email_ID: 'lorn@aballan.tyne',
      Reporter_Description: 'description',
      request: { cookies: {}, headers: {} },
    };

    await reportToIWF(
      {
        ...baseContext,
        IWF_API_COUNTRY_CODE: '1337',
        IWF_API_CHANNEL_ID: '42',
        IWF_API_ENVIRONMENT: 'L',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_URL,
        method: 'POST',
        data: expect.anything(),
      }),
    );

    expect(postedPayload).toMatchObject({
      ...defaultPayload,
      ...omit(event, 'request'),
      Report_Channel_ID: 42,
      Live_Report: 'L',
      Reporter_Country_ID: 1337,
    });
  });

  test('Environment variables should override default values in POST', async () => {
    let postedPayload: IWFReportPayload | undefined;
    // @ts-ignore
    axios.mockImplementationOnce((request) => {
      postedPayload = JSON.parse(request.data);
      return Promise.resolve({
        status: 200,
        data: 'Returned ok',
      });
    });

    const event: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Y',
      request: { cookies: {}, headers: {} },
    };

    await reportToIWF(
      {
        ...baseContext,
        IWF_API_COUNTRY_CODE: '1337',
        IWF_API_CHANNEL_ID: '42',
        IWF_API_ENVIRONMENT: 'L',
      },
      event,
      () => {},
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: baseContext.IWF_API_URL,
        method: 'POST',
        data: expect.anything(),
      }),
    );

    expect(postedPayload).toMatchObject({
      ...defaultPayload,
      Report_Channel_ID: 42,
      Live_Report: 'L',
      Reporter_Country_ID: 1337,
    });
  });

  test('Should return error code if axios call fails (redirect IWF payload)', async () => {
    // @ts-ignore
    axios.mockImplementationOnce(() =>
      Promise.resolve({
        status: 403,
        data: 'Unauthorized',
      }),
    );

    const event: Body = {
      Reported_URL: 'Reported_URL',
      Reporter_Anonymous: 'Y',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(403);
      expect(response.getBody().toString()).toContain('Unauthorized');
    };

    await reportToIWF(baseContext, event, callback);
  });
});
