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
    .update(originalPayloadAsString)
    .digest('base64');

  const isValidRequest = crypto.timingSafeEqual(
    Buffer.from(xLineSignature),
    Buffer.from(expectedSignature),
  );

  return isValidRequest;
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

    const messageEvents = events.filter(e => e.type === 'message');

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
    // eslint-disable-next-line no-console
    console.log(err);
    resolve(error500(err));
  }
};
