/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import axios from 'axios';
import { v4 as uuidV4 } from 'uuid';
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

const LINE_SEND_MESSAGE_URL = 'https://api.line.me/v2/bot/message/push';

type EnvVars = {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  CHAT_SERVICE_SID: string;
};

export type Body = Partial<WebhookEvent> & {
  recipientId?: string; // The Line id of the user that started the conversation. Provided as query parameter
};

const sendLineMessage =
  (context: Context<EnvVars>) => async (recipientId: string, messageText: string) => {
    const payload = {
      to: recipientId,
      messages: [
        {
          type: 'text',
          text: messageText,
        },
      ],
    };

    return axios({
      url: LINE_SEND_MESSAGE_URL,
      method: 'POST',
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': uuidV4(), // Generate a new uuid for each sent message
        Authorization: `Bearer ${context.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });
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
      sendExternalMessage: sendLineMessage(context),
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
