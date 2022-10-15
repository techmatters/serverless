import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as getTranslation, Body } from '../functions/getTranslation';

import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const baseContext = {
  getTwilioClient: jest.fn() as any,
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('getTranslation', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    runtime._addAsset(
      '/translations/es/flexUI.json',
      '../assets/translations/es/flexUI.private.json',
    );
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const event: Body = { language: undefined, request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await getTranslation(baseContext, event, callback);
    await getTranslation(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    const event: Body = { language: 'non-existing', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
    };

    await getTranslation(baseContext, event, callback);
  });

  test('Should return status 200', async () => {
    const event: Body = { language: 'es', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
    };

    await getTranslation(baseContext, event, callback);
  });
});
