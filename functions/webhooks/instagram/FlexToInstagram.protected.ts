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
} from '@tech-matters/serverless-helpers';
import axios from 'axios';
import {
  WebhookEvent,
  FlexToCustomChannel,
} from '../../helpers/customChannels/flexToCustomChannel.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  // FACEBOOK_APP_ID: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;
};

export type Body = Partial<WebhookEvent> & {
  recipientId?: string; // The IGSID of the user that started the conversation. Provided as query parameter
};

const sendInstagramMessage = (context: Context<EnvVars>) => async (
  recipientId: string,
  messageText: string,
) => {
  const body = {
    recipient: {
      id: recipientId,
    },
    message: {
      text: messageText,
    },
  };

  const response = await axios({
    url: `https://graph.facebook.com/v12.0/me/messages?access_token=${context.FACEBOOK_PAGE_ACCESS_TOKEN}`,
    method: 'POST',
    data: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return response.data;
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
    console.log('event.From', event.From);
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

    console.log('------ FlexToInstagram excecution ------');

    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;

    const sanitizedEvent = { Body, From, ChannelSid, EventType, Source };

    const result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
      event: sanitizedEvent,
      recipientId,
      sendExternalMessage: sendInstagramMessage(context),
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
