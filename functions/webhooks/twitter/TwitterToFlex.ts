/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error403,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import crypto from 'crypto';
import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  SYNC_SERVICE_SID: string;
  TWITTER_CONSUMER_KEY: string;
  TWITTER_CONSUMER_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_TOKEN_SECRET: string;
  CHAT_SERVICE_SID: string;
  TWITTER_FLEX_FLOW_SID: string;
};

type MessageCreate = {
  target: string;
  recipient_id: string;
  sender_id: string;
  message_data: {
    text: string;
    entities: {
      hashtags: string[];
      symbols: string[];
      user_mentions: string[];
      urls: string[];
    };
  };
};

type DirectMessageEvent = {
  type: string;
  id: string;
  created_timestamp: string;
  message_create: MessageCreate;
};

export type Body = {
  direct_message_events?: DirectMessageEvent[];
  for_user_id?: string;
  users?: { [key: string]: { name: string; screen_name: string } };
  xTwitterWebhooksSignature?: string;
  bodyAsString?: string;
};

/**
 * Validates that the payload is signed with TWITTER_CONSUMER_SECRET so we know it's comming from Twitter
 */
const isValidTwitterPayload = (event: Body, consumerSecret: string): boolean => {
  if (!event.bodyAsString || !event.xTwitterWebhooksSignature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', consumerSecret)
    .update(event.bodyAsString)
    .digest('base64');

  const isValidRequest = crypto.timingSafeEqual(
    Buffer.from(event.xTwitterWebhooksSignature),
    Buffer.from(`sha256=${expectedSignature}`),
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

  if (!isValidTwitterPayload(event, context.TWITTER_CONSUMER_SECRET)) {
    resolve(error403('Unauthorized'));
    return;
  }

  try {
    // Listen for incoming direct messages
    if (event.direct_message_events) {
      const { for_user_id: forUserId, direct_message_events: directMessageEvents, users } = event;
      if (!forUserId || !directMessageEvents || !directMessageEvents.length || !users)
        throw new Error('Bad formatted direct message event');

      const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
      const channelToFlex = require(handlerPath) as ChannelToFlex;

      const senderExternalId = directMessageEvents[0].message_create.sender_id;
      const subscribedExternalId = forUserId;
      const channelType = channelToFlex.AseloCustomChannels.Instagram;
      const twilioNumber = `${channelType}:${subscribedExternalId}`;
      const chatFriendlyName = `${channelType}:${senderExternalId}`;
      const uniqueUserName = `${channelType}:${senderExternalId}`;
      const senderScreenName = users[senderExternalId].screen_name;
      const messageText = directMessageEvents[0].message_create.message_data.text;
      const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/twitter/FlexToTwitter?recipientId=${senderExternalId}`;

      const result = await channelToFlex.sendMessageToFlex(context, {
        flexFlowSid: context.TWITTER_FLEX_FLOW_SID,
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
          resolve(success(result.response));
          return;
        case 'ignored':
          resolve(success('Ignored event.'));
          return;
        default:
          throw new Error('Reached unexpected default case');
      }
    }

    resolve(success('Ignored event.'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
