/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
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
import { ChatChannelJanitor } from './helpers/chatChannelJanitor.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
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

      // Fetch the Task to close
      const task = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(channelAttributes.taskSid)
        .fetch();

      if (task.assignmentStatus === 'assigned') {
        // Send a Message  TODO:implement localization
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

      // Update the task assignmentStatus
      const updateAssignmentStatus = (assignmentStatus: TaskInstance['assignmentStatus']) =>
        client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(channelAttributes.taskSid)
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

      /* TODO: Once logic for triggering post survey on task wrap is moved to taskRouterCallback, the following clean up can be removed */
      // Deactivate channel and proxy
      const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
      const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid });

      resolve(success(JSON.stringify({ message: 'End Chat OK!' })));
      return;
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
