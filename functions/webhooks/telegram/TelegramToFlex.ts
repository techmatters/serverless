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
};

export type Body = {
  message: {
    chat: { id: string };
    text: string;
  };
  request: {
    headers: Record<string, string>;
  };
};

/**
 * TODO: Implement your own validation logic
 */
const isValidTelegramPayload = (event: Body, helplineBotApiSecretToken: string): boolean =>
  Boolean(event.request.headers['X-Telegram-Bot-Api-Secret-Token'] && helplineBotApiSecretToken);

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('==== FlexToTelegram handler ====');
  console.log('Received event:');
  Object.entries(event).forEach(([key, value]) => {
    console.log(`${key}: ${JSON.stringify(value)}`);
  });
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  if (!isValidTelegramPayload(event, context.TELEGRAM_BOT_API_SECRET_TOKEN)) {
    resolve(error403('Forbidden'));
    return;
  }
  try {
    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;
    const {
      text: messageText,
      chat: { id: senderExternalId },
    } = event.message;
    const channelType = channelToFlex.AseloCustomChannels.Telegram;
    const subscribedExternalId = ''; // This is AseloChat ID on line
    const twilioNumber = `${channelType}:${subscribedExternalId}`;
    const chatFriendlyName = `${channelType}:${senderExternalId}`;
    const uniqueUserName = `${channelType}:${senderExternalId}`;
    const senderScreenName = 'child'; // TODO: how to fetch user Profile Name given its ID (found at 'destination' property)
    const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/line/FlexToTelegram?recipientId=${senderExternalId}`;
    const result = await channelToFlex.sendConversationMessageToFlex(context, {
      studioFlowSid: context.TELEGRAM_STUDIO_FLOW_SID,
      conversationFriendlyName: chatFriendlyName,
      channelType,
      twilioNumber,
      uniqueUserName,
      senderScreenName,
      onMessageSentWebhookUrl,
      messageText,
      senderExternalId,
      subscribedExternalId,
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
