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
} from '../../helpers/customChannels/flexToCustomChannel.private';

type EnvVars = {
  TELEGRAM_FLEX_BOT_TOKEN: string;
};

export type Body = WebhookEvent & {
  recipientId: string; // The Line id of the user that started the conversation. Provided as query parameter
};

const sendTelegramMessage =
  ({ TELEGRAM_FLEX_BOT_TOKEN }: Context<EnvVars>) =>
  async (recipientId: string, messageText: string) => {
    const telegramSendMessageUrl = `https://api.telegram.org/bot${TELEGRAM_FLEX_BOT_TOKEN}/sendMessage`;

    const payload = {
      chat_id: recipientId,
      text: messageText,
    };
    const response = await fetch(telegramSendMessageUrl, {
      method: 'post',
      body: JSON.stringify(payload),
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
  telegramEvent: ConversationWebhookEvent & { recipientId: string },
  callback: ServerlessCallback,
) => {
  console.log('==== FlexToTelegram handler ====');
  console.log('Received event:', telegramEvent);

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    // eslint-disable-next-line global-require,import/no-dynamic-require
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;
    const requiredProperties: (keyof ConversationWebhookEvent | 'recipientId')[] = [
      'ConversationSid',
      'Body',
      'Author',
      'EventType',
      'Source',
      'recipientId',
    ];
    if (!validateProperties(telegramEvent, resolve, requiredProperties)) return;
    const { recipientId, ...event } = telegramEvent;
    const result: RedirectResult =
      await flexToCustomChannel.redirectConversationMessageToExternalChat(context, {
        event,
        recipientId,
        sendExternalMessage: sendTelegramMessage(context),
      });

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
