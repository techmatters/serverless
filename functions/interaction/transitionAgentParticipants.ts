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

import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  bindResolve,
  error400,
  error500,
  functionValidator as TokenValidator,
  responseWithCors,
  success,
} from '@tech-matters/serverless-helpers';
import { InteractionChannelParticipantStatus } from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel/interactionChannelParticipant';
import { InteractionChannelParticipants } from './interactionChannelParticipants.private';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type Body = {
  taskSid: string;
  targetStatus: InteractionChannelParticipantStatus;
  interactionChannelParticipantSid?: string;
  request: { cookies: {}; headers: {} };
};

/**
 * This function looks up a Flex interaction & interaction channel using the attributes of the provided Task.
 * It will then transition any participants in the interaction channel of type 'agent' to the pspecified state.
 * This will automatically wrap up or complete the task in question WITHOUT closing the attached conversation - allowing post wrapup activity like post surveys to be performed
 * This approach is required because the default WrapupTask / CompleteTask Flex Actions will close the conversation, and the ChatOrchestrator cannot be used to prevent this behaviour like it could with Programmable Chat tasks.
 */
export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('==== transitionAgentParticipants ====');
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { path } = Runtime.getFunctions()['interaction/interactionChannelParticipants'];
    // eslint-disable-next-line prefer-destructuring,global-require,import/no-dynamic-require
    const { transitionAgentParticipants }: InteractionChannelParticipants = require(path);
    try {
      const result = await transitionAgentParticipants(
        context.getTwilioClient(),
        context.TWILIO_WORKSPACE_SID,
        event.taskSid,
        event.targetStatus,
        event.interactionChannelParticipantSid,
      );
      if (Array.isArray(result)) {
        return resolve(
          success(
            result.length
              ? `Transitioned agents with interaction channel participant IDs: ${result}`
              : 'No agent participants found in the interaction channel',
          ),
        );
      }
      if (result.errorType === 'Validation') {
        return resolve(error400(result.errorMessage));
      }
      return resolve(error500(new Error(result.errorMessage)));
    } catch (e) {
      return resolve(error500(e as Error));
    }
  },
);
