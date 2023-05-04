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
  error400,
  error500,
  functionValidator as TokenValidator,
  success,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  callSid: string;
  conferenceSid: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { callSid, conferenceSid } = event;
    console.log(`Trying to remove ${callSid} from task ${conferenceSid}`);

    try {
      if (callSid === undefined) return resolve(error400('callSid'));
      if (conferenceSid === undefined) return resolve(error400('conferenceSid'));

      const participantRemoved = await context
        .getTwilioClient()
        .conferences(conferenceSid)
        .participants(callSid)
        .remove();

      console.log(`Removed: ${participantRemoved}`);

      return resolve(success({ message: `Participant removed: ${participantRemoved}` }));
    } catch (err: any) {
      console.error(JSON.stringify(err.message || err));
      return resolve(error500(err));
    }
  },
);
