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

import { Context } from '@twilio-labs/serverless-runtime-types/types';
import {
  InteractionChannelParticipantInstance,
  InteractionChannelParticipantListInstance,
  InteractionChannelParticipantStatus,
} from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel/interactionChannelParticipant';

export const transitionAgentParticipants = async (
  client: ReturnType<Context<any>['getTwilioClient']>,
  twilioWorkspaceSid: string,
  taskSid: string,
  targetStatus: InteractionChannelParticipantStatus,
  interactionChannelParticipantSid?: string,
): Promise<string[] | { errorType: 'Validation' | 'Exception'; errorMessage: string }> => {
  console.log('==== transitionAgentParticipants ====');

  const task = await client.taskrouter.workspaces
    .get(twilioWorkspaceSid)
    .tasks.get(taskSid)
    .fetch();
  const { flexInteractionSid, flexInteractionChannelSid } = JSON.parse(task.attributes);

  if (!flexInteractionSid || !flexInteractionChannelSid) {
    console.warn(
      "transitionAgentParticipants called with a task without a flexInteractionSid or flexInteractionChannelSid set in it's attributes - is it being called with a Programmable Chat task?",
      task.attributes,
    );
    return {
      errorType: 'Validation',
      errorMessage:
        "ValidationError: Task specified must have a flexInteractionSid and flexInteractionChannelSid set in it's attributes",
    };
  }
  const interactionParticipantListInstance: InteractionChannelParticipantListInstance =
    client.flexApi.v1.interaction
      .get(flexInteractionSid)
      .channels.get(flexInteractionChannelSid).participants;
  const interactionAgentParticipants = (await interactionParticipantListInstance.list()).filter(
    (p) =>
      p.type === 'agent' &&
      (p.sid === interactionChannelParticipantSid || !interactionChannelParticipantSid),
  );

  if (interactionAgentParticipants.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    interactionAgentParticipants.map((p) => {
      console.log(`Transitioning agent participant ${p.sid} to ${targetStatus}`);
      Object.entries(p).forEach(([k, v]) => {
        try {
          console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        } catch (e) {
          console.log(`${k}: ${v}`);
        }
      });
      console.log('routing_properties', JSON.stringify((p as any).routing_properties));
      console.log('routingProperties', JSON.stringify((p as any).routingProperties));

      return p.update({ status: targetStatus });
    }),
  );
  const failures: PromiseRejectedResult[] = results.filter(
    (r) => r.status === 'rejected',
  ) as PromiseRejectedResult[];
  failures.forEach((f) => console.warn(f.reason));
  // This is a bit of a hack. Conversations which have been transferred between agents should have all the previous agents removed as participants of the interaction
  // However if they haven't for any reason, they are in a state where their status cannot be transitioned, presumably because they are no longer active in the conversation.
  // I can't see a good way to detect these in the API, so we assume if any of the agents are successfully transitioned, the 'current' agent has been transitioned and the operation can be considered successful.
  // There are probably edge cases where this assumption isn't valid, but this is itself working around an edge case so we would be into edge cases of edge cases there.
  if (failures.length < interactionAgentParticipants.length) {
    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<InteractionChannelParticipantInstance>).value.sid);
  }
  return { errorType: 'Exception', errorMessage: failures[0].reason };
};

export type InteractionChannelParticipants = {
  transitionAgentParticipants: typeof transitionAgentParticipants;
};
