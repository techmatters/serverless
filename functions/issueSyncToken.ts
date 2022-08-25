import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  ACCOUNT_SID: string;
  SYNC_SERVICE_API_KEY: string;
  SYNC_SERVICE_API_SECRET: string;
  SYNC_SERVICE_SID: string;
};

// This is added to event by TokenValidator (if a valid Token was provided) https://www.npmjs.com/package/twilio-flex-token-validator#token-result
export type AuthEvent = {
  TokenResult: {
    identity: string;
  };
  request: { cookies: {}; headers: {} };
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: AuthEvent, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { identity } = event.TokenResult;

      const { ACCOUNT_SID, SYNC_SERVICE_API_KEY, SYNC_SERVICE_API_SECRET, SYNC_SERVICE_SID } =
        context;

      if (!identity) {
        throw new Error('Identity is missing, something is wrong with the token provided');
      }
      if (!(SYNC_SERVICE_API_KEY && SYNC_SERVICE_API_SECRET && SYNC_SERVICE_SID)) {
        throw new Error('Sync Service information missing, set your env vars');
      }

      const { AccessToken } = Twilio.jwt;
      const { SyncGrant } = AccessToken;

      const syncGrant = new SyncGrant({ serviceSid: SYNC_SERVICE_SID });

      const accessToken = new AccessToken(
        ACCOUNT_SID,
        SYNC_SERVICE_API_KEY,
        SYNC_SERVICE_API_SECRET,
        { identity },
      );

      accessToken.addGrant(syncGrant);

      resolve(success({ token: accessToken.toJwt() }));
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(error500(err));
    }
  },
);
