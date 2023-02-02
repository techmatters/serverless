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

export type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

export type Body = {
  taskSid?: string;
  channelSid?: string;
  message?: string;
  from?: string;
  request: { cookies: {}; headers: {} };
};

export const sendSystemMessage = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { taskSid, channelSid, message, from } = event;

  try {
    console.log('------ sendSystemMessage excecution ------');

    if (taskSid && channelSid) {
      resolve(error400('taskSid and channelSid both provided, exactly one expected.'));
      return;
    }

    if (taskSid === undefined && channelSid === undefined) {
      resolve(error400('none of taskSid and channelSid provided, exactly one expected.'));
      return;
    }

    if (message === undefined) {
      resolve(error400('message'));
      return;
    }

    const client = context.getTwilioClient();

    let channelSidToMessage = null;

    if (channelSid !== undefined) {
      channelSidToMessage = channelSid;
    } else if (taskSid !== undefined) {
      const task = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();

      const taskAttributes = JSON.parse(task.attributes);
      const { channelSid: taskChannelSid } = taskAttributes;

      channelSidToMessage = taskChannelSid;
    }

    console.log(`Sending message "${message} to channel ${channelSidToMessage}"`);

    const messageResult = await context
      .getTwilioClient()
      .chat.services(context.CHAT_SERVICE_SID)
      .channels(channelSidToMessage)
      .messages.create({
        body: message,
        from,
        xTwilioWebhookEnabled: 'true',
      });

    resolve(success(messageResult));
  } catch (err: any) {
    resolve(error500(err));
  }
};

export type SendSystemMessageModule = {
  sendSystemMessage: typeof sendSystemMessage;
};

export const handler = TokenValidator(sendSystemMessage);
