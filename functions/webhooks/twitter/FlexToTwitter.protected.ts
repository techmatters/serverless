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
  // TWITTER_ACCESS_TOKEN: string;
  // TWITTER_ACCESS_TOKEN_SECRET: string;
  CHAT_SERVICE_SID: string;
} & { [key: string]: string };

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
  helplineTwitterId: string,
  recipientId: string,
  messageText: string,
) => {
  const twitterAccessToken = context[`TWITTER_ACCESS_TOKEN_${helplineTwitterId}`];
  const twitterAccessTokenSecret = context[`TWITTER_ACCESS_TOKEN_SECRET_${helplineTwitterId}`];

  if (!twitterAccessToken || !twitterAccessTokenSecret)
    throw new Error(
      `TWITTER_ACCESS_TOKEN_${helplineTwitterId} or TWITTER_ACCESS_TOKEN_SECRET_${helplineTwitterId} missing in environment. Please review the setup steps for a new Twitter account and include the access token and secret for Twitter account ${helplineTwitterId}`,
    );

  const T = new Twit({
    consumer_key: context.TWITTER_CONSUMER_KEY,
    consumer_secret: context.TWITTER_CONSUMER_SECRET,
    access_token: twitterAccessToken,
    access_token_secret: twitterAccessTokenSecret,
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
    const helplineTwitterId = channelAttributes.twilioNumber.replace('twitter:', '');

    if (event.Source === 'SDK') {
      const TwitResponse = await sendTwitterMessage(context, helplineTwitterId, recipientId, Body);
      console.log('Message sent from SDK call: ', Body);
      resolve(success(TwitResponse));
      return;
    }

    if (event.Source === 'API' && event.EventType === 'onMessageSent') {
      // Redirect bot, system or third participant
      if (channelAttributes.from !== event.From) {
        const TwitResponse = await sendTwitterMessage(
          context,
          helplineTwitterId,
          recipientId,
          Body,
        );
        console.log('Message sent from API call: ', Body);
        resolve(success(TwitResponse));
        return;
      }

      console.log('Message ignored (do not re-send self messages)');
      resolve(success('Ignored event.'));
      return;
    }

    resolve(send(406)('Event Source not supported'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
