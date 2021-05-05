import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
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
  crc_token?: string;
  direct_message_events?: DirectMessageEvent[];
  for_user_id?: string;
  users?: { [key: string]: { name: string; screen_name: string } };
};

const twitterUniqueNamePrefix = 'twitter:';

/**
 * Retrieves a channel by sid or uniqueName
 */
const retrieveChannel = (context: Context<EnvVars>, uniqueName: string) =>
  context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(uniqueName)
    .fetch();

/**
 * Creates a new Flex channel in the Twitter Flex Flow and subscribes webhooks to it's events
 */
const createTwitterChannel = async (
  context: Context<EnvVars>,
  uniqueChannelName: string,
  senderId: string,
  senderName: string,
) => {
  const client = context.getTwilioClient();

  const channel = await client.flexApi.channel.create({
    flexFlowSid: context.TWITTER_FLEX_FLOW_SID,
    identity: `${senderId}${senderName}`,
    chatUserFriendlyName: senderName,
    chatFriendlyName: uniqueChannelName,
    chatUniqueName: uniqueChannelName,
    target: senderName,
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

  return channel;
};

const sendChatMessage = async (
  context: Context<EnvVars>,
  channelSid: string,
  senderId: string,
  senderName: string,
  messageText: string,
) => {
  const message = await context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .messages.create({
      body: messageText,
      from: senderName,
      xTwilioWebhookEnabled: 'true',
    });

  console.log('Message sent: ', messageText);
  return message;
};

const sendMessageToFlex = async (
  context: Context<EnvVars>,
  senderId: string,
  senderName: string,
  senderScreenName: string,
  messageText: string,
) => {
  const uniqueChannelName = `${twitterUniqueNamePrefix}${senderId}`;
  let channelSid;

  try {
    const channel = await retrieveChannel(context, uniqueChannelName);
    channelSid = channel.sid;
  } catch (err) {
    try {
      console.log('Creating new channel');
      const newChannel = await createTwitterChannel(
        context,
        uniqueChannelName,
        senderId,
        senderName,
      );
      channelSid = newChannel.sid;
    } catch (err2) {
      throw new Error(`Error while creating the new channel ${err2.message}`);
    }
  }

  console.log('Code excecution continued with channelSid: ', channelSid);

  return sendChatMessage(context, channelSid, senderId, senderName, messageText);
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    console.log('------ TwitterToFlex excecution ------');

    // Listen for incoming direct messages
    if (event.direct_message_events) {
      const { for_user_id: activeUser, direct_message_events: directMessageEvents, users } = event;
      if (!activeUser || !directMessageEvents || !directMessageEvents.length || !users)
        throw new Error('Bad formatted direct message event');

      const senderId = directMessageEvents[0].message_create.sender_id;

      if (senderId !== activeUser) {
        console.log(`New message from: ${users[senderId].name}`);
        console.log(directMessageEvents[0].message_create.message_data.text);

        const messageText = directMessageEvents[0].message_create.message_data.text;
        const senderName = users[senderId].name;
        const senderScreenName = users[senderId].screen_name;

        const message = await sendMessageToFlex(
          context,
          senderId,
          senderName,
          senderScreenName,
          messageText,
        );

        resolve(success(message));
        return;
      }

      console.log('Message ignored (do not re-send self messages)');
    }

    resolve(success('Ignored event.'));
  } catch (err) {
    resolve(error500(err));
  }
};
