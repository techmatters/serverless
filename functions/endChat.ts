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
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  channelSid?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    console.log(' ------ endChat execution starts -----');

    try {
      const client = context.getTwilioClient();

      // Use the channelSid to fetch taskSid
      const { channelSid } = event;
      if (channelSid === undefined) {
        resolve(error400('ChannelSid'));
        return;
      }
      const channel = await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .fetch();

      const channelAttributes = JSON.parse(channel.attributes);
      const { taskSid } = channelAttributes;

      // Fetch the Task to close
      const task = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();

      // Update the task assignmentStatus based on current assignment status
      const updateAssignmentStatus = (assignmentStatus: TaskInstance['assignmentStatus']) =>
        client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(taskSid)
          .update({ assignmentStatus });

      switch (task.assignmentStatus) {
        case 'reserved': {
          await updateAssignmentStatus('canceled');
          break;
        }
        case 'pending': {
          await updateAssignmentStatus('canceled');
          break;
        }
        case 'assigned': {
          await updateAssignmentStatus('wrapping');
          break;
        }
        default:
      }

      // isTaskStageAssigned helps in webchat to trigger certain actions, to trigger post surve and send an automated message
      let isTaskStageAssigned = false;

      if (task.assignmentStatus === 'assigned') {
        isTaskStageAssigned = true;

        // Send a Message
        await context
          .getTwilioClient()
          .chat.services(context.CHAT_SERVICE_SID)
          .channels(channelSid)
          .messages.create({
            body: 'User left the conversation.',
            from: 'Bot',
            xTwilioWebhookEnabled: 'true',
          });
      }

      resolve(success({ taskSid, isTaskStageAssigned, message: 'End Chat Ok' }));
      return;
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
