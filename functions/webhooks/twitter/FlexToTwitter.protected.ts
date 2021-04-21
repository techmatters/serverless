import Twit from 'twit';
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  send,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWITTER_CONSUMER_KEY: string;
  TWITTER_CONSUMER_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_TOKEN_SECRET: string;
  CHAT_SERVICE_SID: string;
};

export type Body = {
  recipientId?: string;
  Source?: string;
  Body?: string;
  From?: string;
  ChannelSid?: string;
  EventType?: string;
};

const sendTwitterMessage = async (
  context: Context<EnvVars>,
  recipientId: string,
  messageText: string,
) => {
  const T = new Twit({
    consumer_key: context.TWITTER_CONSUMER_KEY,
    consumer_secret: context.TWITTER_CONSUMER_SECRET,
    access_token: context.TWITTER_ACCESS_TOKEN,
    access_token_secret: context.TWITTER_ACCESS_TOKEN_SECRET,
    timeout_ms: 60 * 1000, // optional HTTP request timeout to apply to all requests.
    strictSSL: true, // optional - requires SSL certificates to be valid.
  });

  const sendTo = {
    event: {
      type: 'message_create',
      message_create: {
        target: {
          recipient_id: recipientId,
        },
        message_data: {
          text: messageText,
        },
      },
    },
  };

  // @ts-ignore
  return T.post('direct_messages/events/new', sendTo);
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { recipientId, Body } = event;

    if (recipientId === undefined) {
      resolve(error400('recipientId'));
      return;
    }

    if (Body === undefined) {
      resolve(error400('Body'));
      return;
    }

    console.log('------ FlexToTwitter excecution ------');

    if (event.Source === 'SDK') {
      const TwitResponse = await sendTwitterMessage(context, recipientId, Body);
      console.log('Message sent from SDK call: ', Body);
      resolve(success(TwitResponse));
      return;
    }

    if (event.Source === 'API' && event.EventType === 'onMessageSent') {
      const { ChannelSid } = event;

      if (ChannelSid === undefined) {
        resolve(error400('ChannelSid'));
        return;
      }

      const client = context.getTwilioClient();
      const channel = await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(ChannelSid)
        .fetch();

      const channelAttributes = JSON.parse(channel.attributes);

      // Redirect bot, system or third participant
      if (channelAttributes.from !== event.From) {
        const TwitResponse = await sendTwitterMessage(context, recipientId, Body);
        console.log('Message sent from API call: ', Body);
        resolve(success(TwitResponse));
        return;
      }

      console.log('Message ignored (do not re-send self messages)');
      resolve(success('Ignored event.'));
    }

    resolve(send(406)('Event Source not supported'));
  } catch (err) {
    resolve(error500(err));
  }
};
