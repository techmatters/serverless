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

/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  error403,
  success,
} from '@tech-matters/serverless-helpers';

import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
  TELEGRAM_STUDIO_FLOW_SID: string;
  TELEGRAM_BOT_API_SECRET_TOKEN: string;
  TELEGRAM_FLEX_BOT_TOKEN: string;
  ACCOUNT_SID: string;
};

export type Body = {
  message: {
    chat: { id: string; first_name: string; username: string };
    text: string;
  };
  request: {
    headers: Record<string, string>;
  };
};

const TELEGRAM_BOT_API_SECRET_TOKEN_HEADER = 'X-Telegram-Bot-Api-Secret-Token'.toLowerCase();

/**
 * TODO: Implement your own validation logic
 */
const isValidTelegramPayload = (event: Body, helplineBotApiSecretToken: string): boolean =>
  Boolean(
    helplineBotApiSecretToken === event.request.headers[TELEGRAM_BOT_API_SECRET_TOKEN_HEADER],
  );

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('==== TelegramToFlex handler ====');
  console.log('Received event:');
  Object.entries(event).forEach(([key, value]) => {
    console.log(`${key}: ${JSON.stringify(value)}`);
  });
  if (event.message) {
    console.log('Received message:');
    Object.entries(event.message).forEach(([key, value]) => {
      console.log(`${key}: ${JSON.stringify(value)}`);
    });
  }
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  if (!context.TELEGRAM_BOT_API_SECRET_TOKEN) {
    const msg = 'TELEGRAM_BOT_API_SECRET_TOKEN is not defined, cannot validate the request';
    console.error(msg);
    resolve(error500(new Error(msg)));
  }

  if (!isValidTelegramPayload(event, context.TELEGRAM_BOT_API_SECRET_TOKEN)) {
    resolve(error403('Forbidden'));
    return;
  }
  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;
    const {
      text: messageText,
      chat: { id: senderExternalId, username, first_name: firstName },
    } = event.message;
    const channelType = channelToFlex.AseloCustomChannels.Telegram;
    const chatFriendlyName = username || `${channelType}:${senderExternalId}`;
    const uniqueUserName = `${channelType}:${senderExternalId}`;
    const senderScreenName = firstName || username || 'child'; // TODO: how to fetch user Profile Name given its ID (found at 'destination' property)
    const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/telegram/FlexToTelegram?recipientId=${senderExternalId}`;
    const result = await channelToFlex.sendConversationMessageToFlex(context, {
      studioFlowSid: context.TELEGRAM_STUDIO_FLOW_SID,
      conversationFriendlyName: chatFriendlyName,
      channelType,
      uniqueUserName,
      senderScreenName,
      onMessageSentWebhookUrl,
      messageText,
      senderExternalId,
    });

    switch (result.status) {
      case 'sent':
        resolve(success(JSON.stringify(result)));
        return;
      case 'ignored':
        resolve(success('Ignored event.'));
        return;
      default:
        resolve(error500(new Error(`Unexpected result status: ${(result as any).status}`)));
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.log(err);
    resolve(error500(err));
  }
};
