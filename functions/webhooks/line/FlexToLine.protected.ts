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

import { v4 as uuidV4 } from 'uuid';
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  ResolveFunction,
} from '@tech-matters/serverless-helpers';

import {
  WebhookEvent,
  FlexToCustomChannel,
  RedirectResult,
  ConversationWebhookEvent,
  ProgrammableChatWebhookEvent,
} from '../../helpers/customChannels/flexToCustomChannel.private';

const LINE_SEND_MESSAGE_URL = 'https://api.line.me/v2/bot/message/push';

type EnvVars = {
  LINE_CHANNEL_ACCESS_TOKEN: string;
  CHAT_SERVICE_SID: string;
};

export type Body = WebhookEvent & {
  recipientId: string; // The Line id of the user that started the conversation. Provided as query parameter
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

    const headers = {
      'Content-Type': 'application/json',
      'X-Line-Retry-Key': uuidV4(), // Generate a new uuid for each sent message
      Authorization: `Bearer ${context.LINE_CHANNEL_ACCESS_TOKEN}`,
    };
    const response = await fetch(LINE_SEND_MESSAGE_URL, {
      method: 'post',
      body: JSON.stringify(payload),
      headers,
    });

    return {
      status: response.status,
      body: await response.json(),
      headers: Object.fromEntries(Object.entries(response.headers)),
    };
  };

const validateProperties = (
  event: any,
  resolveFunc: (f: ResolveFunction) => void,
  requiredProperties: string[],
): boolean => {
  for (const prop of requiredProperties) {
    if (event[prop] === undefined) {
      resolveFunc(error400(prop));
      return false;
    }
  }
  return true;
};

export const handler = async (
  context: Context<EnvVars>,
  lineEvent: Body,
  callback: ServerlessCallback,
) => {
  console.log('==== FlexToLine handler ====');
  console.log('Received event:', lineEvent);
  const eventProperties = Object.entries(lineEvent);
  eventProperties.forEach(([key, value]) => {
    console.log(`${key}: ${JSON.stringify(value)}`);
  });

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    // eslint-disable-next-line global-require,import/no-dynamic-require
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;
    let result: RedirectResult;
    if (flexToCustomChannel.isConversationWebhookEvent(lineEvent)) {
      const requiredProperties: (keyof ConversationWebhookEvent | 'recipientId')[] = [
        'ConversationSid',
        'Body',
        'Author',
        'EventType',
        'Source',
        'recipientId',
      ];
      if (!validateProperties(lineEvent, resolve, requiredProperties)) return;
      const { recipientId, ...event } = lineEvent;
      result = await flexToCustomChannel.redirectConversationMessageToExternalChat(context, {
        event,
        recipientId,
        sendExternalMessage: sendLineMessage(context),
      });
    } else {
      const requiredProperties: (keyof ProgrammableChatWebhookEvent | 'recipientId')[] = [
        'ChannelSid',
        'Body',
        'From',
        'EventType',
        'Source',
        'recipientId',
      ];
      if (!validateProperties(lineEvent, resolve, requiredProperties)) return;

      const { recipientId, ...event } = lineEvent;

      result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
        event,
        recipientId,
        sendExternalMessage: sendLineMessage(context),
      });
    }

    switch (result.status) {
      case 'sent':
        resolve(success(result.response));
        return;
      case 'ignored':
        resolve(success('Ignored event.'));
        return;
      default:
        resolve(error500(new Error('Reached unexpected default case')));
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
