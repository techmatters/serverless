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

const twitterUniqueNamePrefix = 'twitter:';

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

/**
 * Retrieves a channel by sid or uniqueName
 */
const retrieveChannelSid = async (
  context: Context<EnvVars>,
  uniqueSenderName: string,
): Promise<string | undefined> => {
  try {
    const userChannelMap = await context
      .getTwilioClient()
      .sync.services(context.SYNC_SERVICE_SID)
      .documents(uniqueSenderName)
      .fetch();
    console.log('userChannelMap: ', userChannelMap.data);

    return userChannelMap.data.activeChannelSid;
  } catch (err) {
    return undefined;
  }
};

/**
 * Updates the user channel map to contain the new channel assigned for this user
 */
const createUserChannelMap = async (
  context: Context<EnvVars>,
  uniqueSenderName: string,
  channelSid: string,
) => {
  const userChannelMap = await context
    .getTwilioClient()
    .sync.services(context.SYNC_SERVICE_SID)
    .documents.create({
      data: { activeChannelSid: channelSid },
      uniqueName: uniqueSenderName,
      ttl: 259200, // auto removed after 3 days
    });

  console.log('userChannelMap was created from scratch and its value is: ', userChannelMap.data);
};

/**
 * Creates a new Flex channel in the Twitter Flex Flow and subscribes webhooks to it's events
 */
const createTwitterChannel = async (
  context: Context<EnvVars>,
  uniqueChannelName: string,
  senderId: string,
  uniqueSenderName: string, // Unique identifier for this person
  senderScreenName: string, // Twiter handle to show friendly info
  forUserId: string,
) => {
  const twilioNumber = `${twitterUniqueNamePrefix}${forUserId}`;

  const client = context.getTwilioClient();

  const channel = await client.flexApi.channel.create({
    flexFlowSid: context.TWITTER_FLEX_FLOW_SID,
    identity: uniqueSenderName,
    chatUserFriendlyName: senderScreenName,
    chatFriendlyName: uniqueChannelName,
    target: uniqueSenderName,
  });

  const channelAttributes = JSON.parse(
    (
      await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(channel.sid)
        .fetch()
    ).attributes,
  );

  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channel.sid)
    .update({
      attributes: JSON.stringify({
        ...channelAttributes,
        channel_type: 'twitter',
        twitterUserHandle: senderScreenName,
        twilioNumber,
      }),
    });

  /* const onMessageSent = */
  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channel.sid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        method: 'POST',
        url: `https://${context.DOMAIN_NAME}/webhooks/twitter/FlexToTwitter?recipientId=${senderId}`,
        filters: ['onMessageSent'],
      },
    });

  /* const onChannelUpdated = */
  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channel.sid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        method: 'POST',
        url: `https://${context.DOMAIN_NAME}/webhooks/twitter/FlexChannelUpdate`,
        filters: ['onChannelUpdated'],
      },
    });

  return channel.sid;
};

const sendChatMessage = async (
  context: Context<EnvVars>,
  channelSid: string,
  from: string,
  messageText: string,
) => {
  const message = await context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .messages.create({
      body: messageText,
      from,
      xTwilioWebhookEnabled: 'true',
    });

  console.log('Message sent: ', messageText);
  return message;
};

const removeStaleChannel = async (context: Context<EnvVars>, channelSid: string) =>
  context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .remove();

const sendMessageToFlex = async (
  context: Context<EnvVars>,
  senderId: string,
  senderScreenName: string,
  messageText: string,
  forUserId: string,
) => {
  const uniqueChannelName = `${twitterUniqueNamePrefix}${senderId}`;
  const uniqueSenderName = `${twitterUniqueNamePrefix}${senderId}`;
  let channelSid: string | undefined;

  try {
    channelSid = await retrieveChannelSid(context, uniqueSenderName);

    if (!channelSid) {
      console.log('Creating new channel');
      const newChannelSid = await createTwitterChannel(
        context,
        uniqueChannelName,
        senderId,
        uniqueSenderName,
        senderScreenName,
        forUserId,
      );

      channelSid = newChannelSid;
      await createUserChannelMap(context, uniqueSenderName, channelSid);
    }
  } catch (err) {
    const removedStaleChannel = channelSid ? await removeStaleChannel(context, channelSid) : false;
    throw new Error(
      `Error while creating the new channel ${err.message}. Removed stale channel: ${removedStaleChannel}.`,
    );
  }

  console.log('Code excecution continued with channelSid: ', channelSid);

  return sendChatMessage(context, channelSid, uniqueSenderName, messageText);
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
    console.log('------ TwitterToFlex excecution ------');

    // Listen for incoming direct messages
    if (event.direct_message_events) {
      const { for_user_id: forUserId, direct_message_events: directMessageEvents, users } = event;
      if (!forUserId || !directMessageEvents || !directMessageEvents.length || !users)
        throw new Error('Bad formatted direct message event');

      const senderId = directMessageEvents[0].message_create.sender_id;

      if (senderId !== forUserId) {
        console.log(`New message from: ${users[senderId].name}`);
        console.log(directMessageEvents[0].message_create.message_data.text);

        const messageText = directMessageEvents[0].message_create.message_data.text;
        const senderScreenName = users[senderId].screen_name;

        const message = await sendMessageToFlex(
          context,
          senderId,
          senderScreenName,
          messageText,
          forUserId,
        );

        resolve(success(message));
        return;
      }

      console.log('Message ignored (do not re-send self messages)');
    }

    resolve(success('Ignored event.'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
