/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import Twit from 'twit';
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import {
  WebhookEvent,
  FlexToCustomChannel,
} from '../../helpers/customChannels/flexToCustomChannel.private';

type EnvVars = {
  TWITTER_CONSUMER_KEY: string;
  TWITTER_CONSUMER_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_TOKEN_SECRET: string;
  CHAT_SERVICE_SID: string;
};

export type Body = Partial<WebhookEvent> & {
  recipientId?: string; // The Twitter id of the user that started the conversation. Provided as query parameter
};

const sendTwitterMessage = (context: Context<EnvVars>) => async (
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
    const { recipientId, Body, From, ChannelSid, EventType, Source } = event;
    if (recipientId === undefined) {
      resolve(error400('recipientId'));
      return;
    }
    if (Body === undefined) {
      resolve(error400('Body'));
      return;
    }
    if (From === undefined) {
      resolve(error400('From'));
      return;
    }
    if (ChannelSid === undefined) {
      resolve(error400('ChannelSid'));
      return;
    }
    if (EventType === undefined) {
      resolve(error400('EventType'));
      return;
    }
    if (Source === undefined) {
      resolve(error400('Source'));
      return;
    }
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;

    const sanitizedEvent = { Body, From, ChannelSid, EventType, Source };

    const result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
      event: sanitizedEvent,
      recipientId,
      sendExternalMessage: sendTwitterMessage(context),
    });

    switch (result.status) {
      case 'sent':
        resolve(success(result.response));
        return;
      case 'ignored':
        resolve(success('Ignored event.'));
        return;
      default:
        throw new Error('Reached unexpected default case');
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
