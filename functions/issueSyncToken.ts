import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  ACCOUNT_SID: string;
  API_KEY: string;
  API_SECRET: string;
  SYNC_SERVICE_SID: string;
};

type AuthEvent = {
  Token: string;
  TokenResult?: {
    identity: string;
  };
};

type Body = {
  identity?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body & AuthEvent, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const identity = event.TokenResult?.identity || 'unknown';

      const { ACCOUNT_SID, API_KEY, API_SECRET, SYNC_SERVICE_SID } = context;

      const { AccessToken } = Twilio.jwt;
      const { SyncGrant } = AccessToken;

      const syncGrant = new SyncGrant({ serviceSid: SYNC_SERVICE_SID });

      const accessToken = new AccessToken(ACCOUNT_SID, API_KEY, API_SECRET, { identity });

      accessToken.addGrant(syncGrant);

      resolve(success({ token: accessToken.toJwt() }));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
