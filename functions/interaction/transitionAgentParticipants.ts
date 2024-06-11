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
  functionValidator as TokenValidator,
  responseWithCors,
  success,
} from '@tech-matters/serverless-helpers';
import { InteractionChannelParticipantStatus } from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel/interactionChannelParticipant';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type Body = {
  taskSid: string;
  targetStatus: InteractionChannelParticipantStatus;
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
    const { taskSid, targetStatus } = event;

    if (!taskSid) return resolve(error400('taskSid'));
    if (!targetStatus) return resolve(error400('targetStatus'));

    const client = context.getTwilioClient();
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();
    const { flexInteractionSid, flexInteractionChannelSid } = JSON.parse(task.attributes);

    if (!flexInteractionSid || !flexInteractionChannelSid) {
      console.warn(
        "transitionAgentParticipants called with a task without a flexInteractionSid or flexInteractionChannelSid set in it's attributes - is it being called with a Programmable Chat task?",
        task.attributes,
      );
      return resolve(
        error400(
          "Task specified must have a flexInteractionSid and flexInteractionChannelSid set in it's attributes",
        ),
      );
    }
    const interactionParticipantContext = client.flexApi.v1
      .interaction(flexInteractionSid)
      .channels(flexInteractionChannelSid).participants;
    const interactionAgentParticipants = (await interactionParticipantContext.list()).filter(
      (p) => p.type === 'agent',
    );

    // Should only be 1, but just in case
    await Promise.all(
      interactionAgentParticipants.map((p) => {
        console.log(
          `Transitioning agent participant ${p.sid} to ${targetStatus}`,
          p.interactionSid,
          p.channelSid,
        );
        return interactionParticipantContext(p.sid).update({ status: targetStatus });
      }),
    );
    return resolve(success({ message: 'Transitioned agent participants' }));
  },
);
