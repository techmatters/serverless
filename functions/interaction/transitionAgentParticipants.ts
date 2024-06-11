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
