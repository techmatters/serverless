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

      // const updateChannel = client.chat
      //   .services(chatServiceSid)
      //   .channels(channelSid)
      //   .update(channel);

      // await Promise.resolve(updateChannel);

      const channelAttributes = JSON.parse(channel.attributes);

      // const task = client.taskrouter
      //   .workspaces(workplaceSid)
      //   .tasks(channelAttributes.taskSid)
      //   .fetch();

      // await Promise.resolve(task);
      console.log('>> channelAttributes', channelAttributes);
      const msg = 'end chat function is up and running!';

      resolve(success(msg));
      console.log(' ====== endChat execution ends =====');
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
