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

const validUpdates = ['endConferenceOnExit', 'hold', 'muted'] as const;

export type Body = {
  callSid: string;
  conferenceSid: string;
  updateAttribute: typeof validUpdates[number];
  updateValue: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { callSid, conferenceSid, updateAttribute, updateValue } = event;

    try {
      if (!callSid) return resolve(error400('callSid'));
      if (!conferenceSid) return resolve(error400('conferenceSid'));
      if (!updateAttribute || !validUpdates.includes(updateAttribute)) {
        return resolve(error400('updateAttribute'));
      }
      if (!updateValue) return resolve(error400('updateValue'));

      const participant = await context
        .getTwilioClient()
        .conferences(conferenceSid)
        .participants(callSid)
        .fetch();

      const updateAsBool = Boolean(updateValue === 'true');

      switch (updateAttribute) {
        case 'endConferenceOnExit': {
          await participant.update({ endConferenceOnExit: updateAsBool });
          break;
        }
        case 'hold': {
          await participant.update({ hold: updateAsBool });
          break;
        }
        case 'muted': {
          await participant.update({ muted: updateAsBool });
          break;
        }
        default: {
          throw new Error(`'Unexpected case reached, updateAttribute ${updateAttribute}`);
        }
      }

      return resolve(
        success({ message: `Participant updated: ${updateAttribute} ${updateValue}` }),
      );
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
