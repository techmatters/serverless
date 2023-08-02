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
  updates: string;
  request: { cookies: {}; headers: {} };
};

type ParsedUpdates = { [K in typeof validUpdates[number]]?: boolean };
const parseUpdates = (updates: string): ParsedUpdates | null => {
  const parsed = JSON.parse(updates);

  if (
    !parsed ||
    !Object.entries(parsed).every(
      ([k, v]) => validUpdates.includes(k as any) && typeof v === 'boolean',
    )
  ) {
    return null;
  }

  return parsed;
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { callSid, conferenceSid, updates } = event;

    try {
      if (!callSid) return resolve(error400('callSid'));
      if (!conferenceSid) return resolve(error400('conferenceSid'));

      const parsedUpdates = parseUpdates(updates);
      if (!parsedUpdates) {
        return resolve(error400('updates'));
      }

      const participant = await context
        .getTwilioClient()
        .conferences(conferenceSid)
        .participants(callSid)
        .fetch();

      await participant.update(parsedUpdates);

      return resolve(success({ message: `Participant updated: ${updates}` }));
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
