import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
// import axios from 'axios';
// import { omit } from 'lodash';
import {
  handler as selfReportToIWF,
  Body,
  //   IWFSelfReportPayload,
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

// const defaultPayload = {
//   secret_key: 'wert-dcfrr-45t5f-aq1oooiu',
//   case_number: 'mhyi9-5690t-opwr4-aaswq',
//   user_age_range: '<13',
// };

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

  test('Should return status 500', async () => {
    const event: Body = {
      user_age_range: '13-15',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
    };
    await selfReportToIWF(baseContext, event, callback);
  });

  //   test('Should return status 500', async () => {
  //     jest.spyOn(Buffer, 'from').mockImplementationOnce(() => {
  //       throw new Error('Boom!');
  //     });

  //     const event: Body = {
  //       user_age_range: '13-15',
  //       request: { cookies: {}, headers: {} },
  //     };

  //     const callback: ServerlessCallback = (err, result) => {
  //       expect(result).toBeDefined();
  //       const response = result as MockedResponse;
  //       expect(response.getStatus()).toBe(500);
  //       expect(response.getBody().message).toContain('Boom!');
  //     };

  //     await selfReportToIWF(baseContext, event, callback);
  //   });
});
