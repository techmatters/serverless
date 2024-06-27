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
  ResolveFunction,
} from '@tech-matters/serverless-helpers';

import {
  ConversationWebhookEvent,
  ExternalSendResult,
  FlexToCustomChannel,
  ProgrammableChatWebhookEvent,
  RedirectResult,
  WebhookEvent,
} from '../../helpers/customChannels/flexToCustomChannel.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  // FACEBOOK_APP_ID: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;
};

export type Body = WebhookEvent & {
  recipientId: string; // The IGSID of the user that started the conversation. Provided as query parameter
};

const sendInstagramMessage =
  (context: Context<EnvVars>) =>
  async (recipientId: string, messageText: string): Promise<ExternalSendResult> => {
    const body = {
      recipient: {
        id: recipientId,
      },
      message: {
        text: messageText,
      },
    };

    const response = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${context.FACEBOOK_PAGE_ACCESS_TOKEN}`,
      {
        method: 'post',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      ok: response.ok,
      resultCode: response.status,
      body: await response.json(),
      meta: Object.fromEntries(Object.entries(response.headers)),
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
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    // eslint-disable-next-line global-require,import/no-dynamic-require
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;

    let result: RedirectResult;

    if (flexToCustomChannel.isConversationWebhookEvent(event)) {
      const requiredProperties: (keyof ConversationWebhookEvent | 'recipientId')[] = [
        'ConversationSid',
        'Body',
        'Author',
        'EventType',
        'Source',
        'recipientId',
      ];
      if (!validateProperties(event, resolve, requiredProperties)) return;

      const { recipientId, ...eventToSend } = event;

      result = await flexToCustomChannel.redirectConversationMessageToExternalChat(context, {
        event: eventToSend,
        recipientId,
        sendExternalMessage: sendInstagramMessage(context),
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
      if (!validateProperties(event, resolve, requiredProperties)) return;

      const { recipientId, ...sanitizedEvent } = event;

      result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
        event: sanitizedEvent,
        recipientId,
        sendExternalMessage: sendInstagramMessage(context),
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
