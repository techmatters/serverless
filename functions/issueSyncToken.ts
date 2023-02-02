/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

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

export const handler = TokenValidator(
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
      resolve(error500(err));
    }
  },
);
