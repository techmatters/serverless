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
  error403,
  success,
  send,
} from '@tech-matters/serverless-helpers';
import crypto from 'crypto';

import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
  LINE_FLEX_FLOW_SID: string;
  LINE_CHANNEL_SECRET: string;
};

type LineMessage = {
  type: 'text' | string;
  id: string;
  text: string;
};

type LineSource = {
  type: 'user' | 'group' | 'room';
  userId: string;
};

type LineEvent = {
  type: 'message' | string;
  message: LineMessage;
  timestamp: number;
  replyToken: string;
  source: LineSource;
};

type Request = {
  headers: {
    [header: string]: string;
  };
};

export type Body = {
  destination: string;
  events: LineEvent[];
  request: Request;
};

// https://gist.github.com/jirawatee/366d6bef98b137131ab53dfa079bd0a4 - but fixed :facepalm:
// We get signature mismatches when emojis are present in the payload because the signature on the line side seems to have been generated using escaped versions of emoji unicode characters
const fixUnicodeForLine = (text: string): string =>
  text.replace(/\p{Emoji_Presentation}/gu, (emojiChars) =>
    emojiChars
      .split('')
      .map((c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`)
      .join(''),
  );

/**
 * Validates that the payload is signed with LINE_CHANNEL_SECRET so we know it's comming from Line
 */
const isValidLinePayload = (event: Body, lineChannelSecret: string): boolean => {
  const xLineSignature = event.request.headers['x-line-signature'];
  if (!xLineSignature) return false;

  // Twilio Serverless adds a 'request' property the payload
  const { request, ...originalPayload } = event;
  const originalPayloadAsString = JSON.stringify(originalPayload);

  const expectedSignature = crypto
    .createHmac('sha256', lineChannelSecret)
    .update(fixUnicodeForLine(originalPayloadAsString))
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(xLineSignature), Buffer.from(expectedSignature));
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  if (!isValidLinePayload(event, context.LINE_CHANNEL_SECRET)) {
    resolve(error403('Forbidden'));
    return;
  }

  try {
    const { destination, events } = event;

    const messageEvents = events.filter((e) => e.type === 'message');

    if (messageEvents.length === 0) {
      resolve(success('No messages to send'));
      return;
    }

    if (!destination) {
      throw new Error('Missing destination property');
    }

    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;

    const responses = [];
    for (let i = 0; i < messageEvents.length; i += 1) {
      const messageText = messageEvents[i].message.text;
      const channelType = channelToFlex.AseloCustomChannels.Line;
      const subscribedExternalId = destination; // This is AseloChat ID on line
      const twilioNumber = `${channelType}:${subscribedExternalId}`;
      const senderExternalId = messageEvents[i].source.userId; // This is the child ID on Line
      const chatFriendlyName = `${channelType}:${senderExternalId}`;
      const uniqueUserName = `${channelType}:${senderExternalId}`;
      const senderScreenName = 'child'; // TODO: how to fetch user Profile Name given its ID (found at 'destination' property)
      const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/line/FlexToLine?recipientId=${senderExternalId}`;

      // eslint-disable-next-line no-await-in-loop
      const result = await channelToFlex.sendMessageToFlex(context, {
        flexFlowSid: context.LINE_FLEX_FLOW_SID,
        chatServiceSid: context.CHAT_SERVICE_SID,
        syncServiceSid: context.SYNC_SERVICE_SID,
        channelType,
        twilioNumber,
        chatFriendlyName,
        uniqueUserName,
        senderScreenName,
        onMessageSentWebhookUrl,
        messageText,
        senderExternalId,
        subscribedExternalId,
      });

      switch (result.status) {
        case 'sent':
          responses.push(result.response);
          break;
        case 'ignored':
          responses.push('Ignored event.');
          break;
        default:
          throw new Error('Reached unexpected default case');
      }
    }

    resolve(success(responses.join()));
  } catch (err: any) {
    /*
      For now, we are hard coding the error handler as we will need to update
      the error handler in Techmatters helper library to accomodate the channelType
    */
    const error500 = (error: Error, channelType: string) =>
      send(500)({ message: error.message, stack: error.stack, status: 500, channelType });

    // eslint-disable-next-line no-console
    // This will identify which custom channel the error originates from
    resolve(error500(err, 'line'));
  }
};
