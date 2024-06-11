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
