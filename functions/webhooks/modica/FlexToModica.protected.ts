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
import fetch from 'node-fetch';
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

// This can be a candidate to be an environment variable
const MODICA_SEND_MESSAGE_URL = 'https://api.modicagroup.com/rest/gateway/messages';

export type EnvVars = {
  MODICA_APP_NAME: string;
  MODICA_APP_PASSWORD: string;
  CHAT_SERVICE_SID: string;
};

export type Body = WebhookEvent & {
  recipientId: string; // The phone number of the user that started the conversation. Provided as query parameter
};

/**
 * This function adds a '+' symbol at the beginning of the recipientId if it's missing.
 * Modica expects the destination to be in E.164 format.
 *
 * Not sure why recipientId is not including the '+' symbol at the beginning.
 * Chances are it's an encoding issue, because it's being passed as a query parameter.
 * Also, it seems it's necessary to trim the recipientId, as well, because it's including
 * a space at the beginning for some reason.
 *
 * See onMessageSentWebhookUrl in ModicaToFlex.ts
 */
const sanitizeRecipientId = (recipientIdRaw: string) => {
  const recipientId = recipientIdRaw.trim();

  if (recipientId.charAt(0) !== '+') {
    return `+${recipientId}`;
  }

  return recipientId;
};

const sendMessageThroughModica =
  (context: Context<EnvVars>) => async (recipientId: string, messageText: string) => {
    const payload = {
      destination: sanitizeRecipientId(recipientId),
      content: messageText,
    };

    const base64Credentials = Buffer.from(
      `${context.MODICA_APP_NAME}:${context.MODICA_APP_PASSWORD}`,
    ).toString('base64');

    /**
     * I was struggling to make this call to work with Axios,
     * so I used node-fetch instead.
     */
    const response = await fetch(MODICA_SEND_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${base64Credentials}`,
      },
      body: JSON.stringify(payload),
    });

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
  modicaEvent: Body,
  callback: ServerlessCallback,
) => {
  console.log('==== FlexToModica handler ====');
  console.log('Received event:', modicaEvent);
  const eventProperties = Object.entries(modicaEvent);
  eventProperties.forEach(([key, value]) => {
    console.log(`${key}: ${JSON.stringify(value)}`);
  });
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/flexToCustomChannel'].path;
    const flexToCustomChannel = require(handlerPath) as FlexToCustomChannel;
    let result: RedirectResult;

    if (flexToCustomChannel.isConversationWebhookEvent(modicaEvent)) {
      const requiredProperties: (keyof ConversationWebhookEvent | 'recipientId')[] = [
        'ConversationSid',
        'Body',
        'Author',
        'EventType',
        'Source',
        'recipientId',
      ];
      if (!validateProperties(modicaEvent, resolve, requiredProperties)) return;
      const { recipientId, ...event } = modicaEvent;
      result = await flexToCustomChannel.redirectConversationMessageToExternalChat(context, {
        event,
        recipientId,
        sendExternalMessage: sendMessageThroughModica(context),
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
      if (!validateProperties(modicaEvent, resolve, requiredProperties)) return;

      const { recipientId, ...event } = modicaEvent;

      result = await flexToCustomChannel.redirectMessageToExternalChat(context, {
        event,
        recipientId,
        sendExternalMessage: sendMessageThroughModica(context),
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
        throw new Error('Reached unexpected default case');
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
