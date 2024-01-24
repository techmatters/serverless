/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

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

const sendInstagramMessage =
  (context: Context<EnvVars>) => async (recipientId: string, messageText: string) => {
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
    throw new Error('this is testing error fromFlexToInstagram')
    // const { recipientId, Body, From, ChannelSid, EventType, Source } = event;
    // if (recipientId === undefined) {
    //   resolve(error400('recipientId'));
    //   return;
    // }
    // if (Body === undefined) {
    //   resolve(error400('Body'));
    //   return;
    // }
    // if (From === undefined) {
    //   resolve(error400('From'));
    //   return;
    // }
    // if (ChannelSid === undefined) {
    //   resolve(error400('ChannelSid'));
    //   return;
    // }
    // if (EventType === undefined) {
    //   resolve(error400('EventType'));
    //   return;
    // }
    // if (Source === undefined) {
    //   resolve(error400('Source'));
    //   return;
    // }

    // const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    // const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;

    // const sanitizedEvent = {
    //   Body,
    //   From,
    //   ChannelSid,
    //   EventType,
    //   Source,
    // };

    // const result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
    //   event: sanitizedEvent,
    //   recipientId,
    //   sendExternalMessage: sendInstagramMessage(context),
    // });

    // switch (result.status) {
    //   case 'sent':
    //     resolve(success(result.response));
    //     return;
    //   case 'ignored':
    //     resolve(success('Ignored event.'));
    //     return;
    //   default:
    //     throw new Error('Reached unexpected default case');
    // }
  } catch (err: any) {
    err.channelType = 'instagram';
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
