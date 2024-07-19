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
    const task = await client.taskrouter.workspaces
      .get(context.TWILIO_WORKSPACE_SID)
      .tasks.get(taskSid)
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
    const interactionParticipantContext = client.flexApi.v1.interaction
      .get(flexInteractionSid)
      .channels.get(flexInteractionChannelSid).participants;
    const interactionAgentParticipants = (await interactionParticipantContext.list()).filter(
      (p) => p.type === 'agent',
    );

    if (interactionAgentParticipants.length === 0) {
      resolve(
        success({
          message: 'No agent participants found in the interaction channel',
        }),
      );
    }

    const results = await Promise.allSettled(
      interactionAgentParticipants.map((p) => {
        console.log(`Transitioning agent participant ${p.sid} to ${targetStatus}`);
        Object.entries(p).forEach(([k, v]) => console.log(`${k}: ${v}`));
        return p.update({ status: targetStatus });
      }),
    );
    const failures: PromiseRejectedResult[] = results.filter(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult[];
    failures.forEach((f) => console.warn(f.reason));

    // This is a bit of a hack. Conversations which have been transferred between agents still have all the previous agents as participants of the interaction
    // However they are in a state where their status cannot be transitioned, presumably because they are no longer active in the conversation.
    // I can't see a good way to detect these in the API, so we assume if any of the agents are successfully transitioned, the 'current' agent has been transitioned and the operation can be considered successful.
    // There are probably edge cases where this assumption isn't valid, so we should look to improve this in the future.
    if (failures.length < interactionAgentParticipants.length) {
      return resolve(
        success({
          message: `Transitioned ${interactionAgentParticipants.length - failures.length} / ${
            interactionAgentParticipants.length
          } agent participants (we only need one)`,
        }),
      );
    }
    return resolve(error500(failures[0].reason));
  },
);
