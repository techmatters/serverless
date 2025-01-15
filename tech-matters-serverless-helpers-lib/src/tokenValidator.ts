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

import { validator } from 'twilio-flex-token-validator';
import {
  EnvironmentVariables,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

const isWorker = (tokenResult: TokenValidatorResponse) =>
  tokenResult.worker_sid && tokenResult.worker_sid.startsWith('WK');
const isGuest = (tokenResult: TokenValidatorResponse) =>
  Array.isArray(tokenResult.roles) && tokenResult.roles.includes('guest');

export const functionValidator = <
  T extends EnvironmentVariables,
  U extends { request: { cookies: {}; headers: {} }; Token?: string },
>(
  handlerFn: ServerlessFunctionSignature<T, U>,
  options: { allowGuestToken?: boolean } = {},
): ServerlessFunctionSignature<T, U> => {
  return async (context, event, callback) => {
    const failedResponse = (message: string) => {
      const response = new Twilio.Response();
      response.appendHeader('Access-Control-Allow-Origin', '*');
      response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
      response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.appendHeader('Content-Type', 'plain/text');
      response.setStatusCode(403);
      response.setBody(message);

      callback(null, response);
    };

    const accountSid = context.ACCOUNT_SID;
    const authToken = context.AUTH_TOKEN;
    const token = event.Token;

    if (!accountSid || !authToken) {
      return failedResponse(
        'Unauthorized: AccountSid or AuthToken was not provided. For more information, please visit https://twilio.com/console/runtime/functions/configure',
      );
    }

    if (!token) {
      return failedResponse('Unauthorized: token was not provided.');
    }

    try {
      const tokenResult: TokenValidatorResponse = await validator(token, accountSid, authToken)
      const isGuestToken = !isWorker(tokenResult) || isGuest(tokenResult);
      if (isGuestToken && !options.allowGuestToken) {
        return failedResponse('Unauthorized: endpoint not open to guest tokens.');
      }

      const updatedEvent = { ...event, TokenResult: tokenResult };
      return handlerFn(context, updatedEvent, callback);
    } catch (err) {
      if (err instanceof Error) {
        return failedResponse(err.message);
      } else {
        return failedResponse(JSON.stringify(err));
      }
    }
  };
};

export type FunctionValidator = typeof functionValidator;
