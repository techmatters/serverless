import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  taskSid?: string;
  channelSid?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    console.log(' ====== endChat execution starts =====');

    try {
      const client = context.getTwilioClient();
      const chatServiceSid = context.CHAT_SERVICE_SID;
      const workplaceSid = context.TWILIO_WORKSPACE_SID;

      const { channelSid } = event;

      if (channelSid === undefined) {
        resolve(error400('ChannelSid'));
        return;
      }

      const channel = await client.chat.services(chatServiceSid).channels(channelSid).fetch();
      const channelAttributes = JSON.parse(channel.attributes);

      // Fetch the Task
      const task = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(channelAttributes.taskSid)
        .fetch();

      // Error handling
      if (['canceled', 'completed', 'wrapping'].includes(task.assignmentStatus)) {
        throw new Error(
          `Task SID ${channelAttributes.taskSid} is already in ${task.assignmentStatus} state.`,
        );
      }

      const taskUpdate = {
        assignmentStatus: task.assignmentStatus,
      };

      switch (task.assignmentStatus) {
        case 'pending':
          break;
        case 'reserved':
          taskUpdate.assignmentStatus = 'canceled';
          break;
        case 'assigned':
          taskUpdate.assignmentStatus = 'wrapping';
          break;
        default:
      }

      await client.taskrouter
        .workspaces(workplaceSid)
        .tasks(channelAttributes.taskSid)
        .update(taskUpdate);
      console.log('>> channelAttributes', channelAttributes);
      const msg = 'end chat function is up and running!';

      resolve(success(msg));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
