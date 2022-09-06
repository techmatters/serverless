import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import * as jwt from 'jsonwebtoken';
import { handler as issueSyncToken, AuthEvent } from '../functions/issueSyncToken';

import helpers, { MockedResponse } from './helpers';

const baseContext = {
  getTwilioClient: (): any => null,
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACxxx',
  SYNC_SERVICE_API_KEY: 'api-key',
  SYNC_SERVICE_API_SECRET: 'api-secret',
  SYNC_SERVICE_SID: 'ISxxx',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('issueSyncToken', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 500', async () => {
    const event1: AuthEvent = {
      TokenResult: {
        identity: '',
      },
      request: { cookies: {}, headers: {} },
    };
    const event2: AuthEvent = {
      TokenResult: {
        identity: 'worker1',
      },
      request: { cookies: {}, headers: {} },
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'Identity is missing, something is wrong with the token provided',
      );
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().message).toContain(
        'Sync Service information missing, set your env vars',
      );
    };

    const anotherContext1 = { ...baseContext, SYNC_SERVICE_SID: undefined };
    const anotherContext2 = { ...baseContext, SYNC_SERVICE_SID: undefined };
    const anotherContext3 = { ...baseContext, SYNC_SERVICE_SID: undefined };

    await issueSyncToken(baseContext, event1, callback1);
    await Promise.all(
      [anotherContext1, anotherContext2, anotherContext3].map((context) =>
        issueSyncToken(context, event2, callback2),
      ),
    );
  });

  test('Should return status 200 (with valid token)', async () => {
    const event: AuthEvent = {
      TokenResult: {
        identity: 'worker1',
      },
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();

      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);

      const { token } = response.getBody();
      expect(typeof token).toBe('string');

      const verifyCallback: jwt.VerifyCallback = (error, decoded: any) => {
        expect(error).toBeNull();
        expect(decoded.iss).toBe(baseContext.SYNC_SERVICE_API_KEY);
        expect(decoded.sub).toBe(baseContext.ACCOUNT_SID);
        expect(decoded.grants).toEqual({
          identity: event.TokenResult.identity,
          data_sync: {
            service_sid: baseContext.SYNC_SERVICE_SID,
          },
        });
      };

      jwt.verify(token, baseContext.SYNC_SERVICE_API_SECRET, verifyCallback);
    };

    await issueSyncToken(baseContext, event, callback);
  });
});
