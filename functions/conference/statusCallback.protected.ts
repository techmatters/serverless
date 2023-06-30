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
  error400,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  SYNC_SERVICE_SID: string;
};

export type Body = {
  callStatusSyncDocumentSid?: string;
  CallStatus: string;
  request: { cookies: {}; headers: {} };
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
  // eslint-disable-next-line consistent-return
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { callStatusSyncDocumentSid, CallStatus } = event;

  const client = context.getTwilioClient();
  try {
    if (!callStatusSyncDocumentSid) return resolve(error400('callStatusSyncDocumentSid'));

    await client.sync
      .services(context.SYNC_SERVICE_SID)
      .documents(callStatusSyncDocumentSid)
      .update({ data: { CallStatus } });

    resolve(success('Ok'));
  } catch (err: any) {
    resolve(error500(err));
  }
};
