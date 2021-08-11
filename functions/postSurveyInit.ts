import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  CHAT_SERVICE_SID: string;
};

export type Body = {
  channelSid?: string;
};

const triggerPostSurveyFlow = async (context: Context<EnvVars>, channelSid: string) => {
  const client = context.getTwilioClient();

  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        filters: ['onMessageSent'],
        method: 'POST',
        url:
          'https://channels.autopilot.twilio.com/v1/ACd8a2e89748318adf6ddff7df6948deaf/UA59f7eb8ec74c4a18b229f7d6ff5a63ab/twilio-chat', // TODO: move url to env vars (edit deploy scripts needed)
      },
    });

  const messageResult = await context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .messages.create({
      body: 'Hey! Before you leave, can you answer a few questions about this contact?',
      xTwilioWebhookEnabled: 'true',
    });

  return messageResult;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { channelSid } = event;

    try {
      if (channelSid === undefined) return resolve(error400('channelSid'));

      await triggerPostSurveyFlow(context, channelSid);

      return resolve(success(JSON.stringify({ message: 'Post survey init OK!' })));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
