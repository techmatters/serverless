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
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  error403,
  success,
} from '@tech-matters/serverless-helpers';
import axios from 'axios';
import crypto from 'crypto';

const validateToken = require('twilio-flex-token-validator').validator;

export type Body = {
  payload: string;
  Token?: string;
  ApiKey?: string;
  request: { cookies: {}; headers: {} };
};

type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  SAVE_PENDING_CONTACTS_STATIC_KEY: string;
  SAFERNET_ENDPOINT: string;
  SAFERNET_TOKEN: string;
};

const isValidRequest = async (context: Context<EnvVars>, event: Body) => {
  const { ACCOUNT_SID, AUTH_TOKEN, SAVE_PENDING_CONTACTS_STATIC_KEY } = context;
  const { Token, ApiKey } = event;

  if (Token) {
    try {
      await validateToken(Token, ACCOUNT_SID, AUTH_TOKEN);
      return true;
    } catch (err) {
      return false;
    }
  } else if (ApiKey) {
    return ApiKey === SAVE_PENDING_CONTACTS_STATIC_KEY;
  }

  return false;
};

export const handler: ServerlessFunctionSignature<EnvVars, Body> = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { SAFERNET_ENDPOINT, SAFERNET_TOKEN, SAVE_PENDING_CONTACTS_STATIC_KEY } = context;

  if (!SAFERNET_ENDPOINT) throw new Error('SAFERNET_ENDPOINT env var not provided.');
  if (!SAFERNET_TOKEN) throw new Error('SAFERNET_TOKEN env var not provided.');
  if (!SAVE_PENDING_CONTACTS_STATIC_KEY) {
    throw new Error('SAVE_PENDING_CONTACTS_STATIC_KEY env var not provided.');
  }

  const isValid = await isValidRequest(context, event);

  if (!isValid) {
    resolve(error403('No AccessToken or ApiKey was found'));
    return;
  }

  try {
    const { payload } = event;
    const payloadAsString = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const signedPayload = crypto
      .createHmac('sha256', SAFERNET_TOKEN)
      .update(encodeURIComponent(payloadAsString))
      .digest('hex');

    const saferNetResponse = await axios.request({
      url: SAFERNET_ENDPOINT,
      method: 'post',
      data: JSON.parse(payloadAsString),
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': `sha256=${signedPayload}`,
      },
    });

    if (saferNetResponse.data.success) {
      resolve(success(saferNetResponse.data.post_survey_link));
    } else {
      const errorMessage = saferNetResponse.data.error_message;

      // eslint-disable-next-line no-console
      console.warn(errorMessage);
      resolve(error500(new Error(errorMessage)));
    }
  } catch (err: any) {
    resolve(error500(err));
  }
};

export type SaveContact = typeof handler;
