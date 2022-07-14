import { Context } from '@twilio-labs/serverless-runtime-types/types';

/**
 * Looks in Sync Service for the userChannelMap named after uniqueUserName
 */
export const retrieveChannelFromUserChannelMap = async (
  context: Context,
  {
    syncServiceSid,
    uniqueUserName,
  }: {
    syncServiceSid: string;
    uniqueUserName: string;
  },
): Promise<string | undefined> => {
  try {
    const userChannelMap = await context
      .getTwilioClient()
      .sync.services(syncServiceSid)
      .documents(uniqueUserName)
      .fetch();

    return userChannelMap.data.activeChannelSid;
  } catch (err) {
    return undefined;
  }
};

/**
 * Creates a user channel map in Sync Service to contain the sid of the new channel assigned for a user
 */
export const createUserChannelMap = async (
  context: Context,
  {
    syncServiceSid,
    uniqueUserName,
    channelSid,
  }: {
    syncServiceSid: string;
    uniqueUserName: string;
    channelSid: string;
  },
) => {
  // const userChannelMap =
  await context
    .getTwilioClient()
    .sync.services(syncServiceSid)
    .documents.create({
      data: { activeChannelSid: channelSid },
      uniqueName: uniqueUserName,
      ttl: 259200, // auto removed after 3 days
    });
};

/**
 * Sends a new message to the provided chat channel
 */
export const sendChatMessage = async (
  context: Context,
  {
    chatServiceSid,
    channelSid,
    from,
    messageText,
    messageAttributes,
  }: {
    chatServiceSid: string;
    channelSid: string;
    from: string;
    messageText: string;
    messageAttributes?: string;
  },
) => {
  const message = await context
    .getTwilioClient()
    .chat.services(chatServiceSid)
    .channels(channelSid)
    .messages.create({
      body: messageText,
      from,
      xTwilioWebhookEnabled: 'true',
      ...(messageAttributes && { attributes: messageAttributes }),
    });

  return message;
};

export const removeChatChannel = async (
  context: Context,
  {
    chatServiceSid,
    channelSid,
  }: {
    chatServiceSid: string;
    channelSid: string;
  },
) =>
  context
    .getTwilioClient()
    .chat.services(chatServiceSid)
    .channels(channelSid)
    .remove();

export enum AseloCustomChannels {
  Twitter = 'twitter',
  Instagram = 'instagram',
}

type CreateFlexChannelParams = {
  flexFlowSid: string;
  chatServiceSid: string;
  channelType: AseloCustomChannels; // The chat channel being used
  twilioNumber: string; // The target Twilio number (usually have the shape <channel>:<id>, e.g. twitter:1234567)
  chatFriendlyName: string; // A name for the Flex channel (tipcally same as uniqueUserName)
  uniqueUserName: string; // Unique identifier for this user
  senderScreenName: string; // Friendly info to show to show in the Flex UI (like Twitter handle)
  onMessageSentWebhookUrl: string; // The url that must be used as the onMessageSent event webhook.
  onChannelUpdatedWebhookUrl?: string; // The url that must be used as the onChannelUpdated event webhook. If not present, it defaults to https://${context.DOMAIN_NAME}/webhooks/FlexChannelUpdate
};

/**
 * Creates a new Flex chat channel in the provided Flex Flow and subscribes webhooks to it's events.
 * Adds to the channel attributes the provided twilioNumber used for routing.
 */
const createFlexChannel = async (
  context: Context,
  {
    flexFlowSid,
    chatServiceSid,
    channelType,
    twilioNumber,
    chatFriendlyName,
    uniqueUserName,
    senderScreenName,
    onMessageSentWebhookUrl,
    onChannelUpdatedWebhookUrl,
  }: CreateFlexChannelParams,
) => {
  // const twilioNumber = `${twitterUniqueNamePrefix}${forUserId}`;

  const client = context.getTwilioClient();

  const channel = await client.flexApi.channel.create({
    flexFlowSid,
    identity: uniqueUserName,
    target: uniqueUserName, // Twilio sets channel.attributes.from with this value
    chatUserFriendlyName: senderScreenName,
    chatFriendlyName,
  });

  const channelAttributes = JSON.parse(
    (
      await client.chat
        .services(chatServiceSid)
        .channels(channel.sid)
        .fetch()
    ).attributes,
  );

  await client.chat
    .services(chatServiceSid)
    .channels(channel.sid)
    .update({
      attributes: JSON.stringify({
        ...channelAttributes,
        channel_type: channelType,
        senderScreenName, // TODO: in Twitter this is "twitterUserHandle". Rework that in the UI when we use this
        twilioNumber,
      }),
    });

  /* const onMessageSent = */
  await client.chat
    .services(chatServiceSid)
    .channels(channel.sid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        method: 'POST',
        url: onMessageSentWebhookUrl,
        filters: ['onMessageSent'],
      },
    });

  /* const onChannelUpdated = */
  await client.chat
    .services(chatServiceSid)
    .channels(channel.sid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        method: 'POST',
        url:
          onChannelUpdatedWebhookUrl || `https://${context.DOMAIN_NAME}/webhooks/FlexChannelUpdate`,
        filters: ['onChannelUpdated'],
      },
    });

  return channel.sid;
};

type SendMessageToFlexParams = CreateFlexChannelParams & {
  syncServiceSid: string; // The Sync Service sid where user channel maps are stored
  messageText: string; // The body of the message to send
  messageAttributes?: string; // [optional] The message attributes
  senderExternalId: string; // The id in the external chat system of the user sending the message
  subscribedExternalId: string; // The id in the external chat system of the user that is subscribed to the webhook
};

/**
 * Given a uniqueUserName, tries to send a message to the active chat channel for this user.
 * To retrieve the channel we do a lookup on the user channel map stored in Sync Service.
 * If the channel or the map does not exists, we create it here.
 * The uniqueUserName is typacally '<channelType>:<unique identifier of the sender>'
 *   (e.g. if the message is sent by Twitter user 1234567, the uniqueUserName will be 'twitter:1234567')
 */
export const sendMessageToFlex = async (
  context: Context,
  {
    flexFlowSid,
    chatServiceSid,
    channelType,
    twilioNumber,
    chatFriendlyName,
    uniqueUserName,
    senderScreenName,
    onMessageSentWebhookUrl,
    onChannelUpdatedWebhookUrl,
    syncServiceSid,
    messageText,
    messageAttributes = undefined,
    senderExternalId,
    subscribedExternalId,
  }: SendMessageToFlexParams,
): Promise<{ status: 'ignored' } | { status: 'sent'; response: any }> => {
  // Do not send messages that were sent by the receiverId (account subscribed to the webhook), as they were either sent from Flex or from the specific UI of the chat system
  if (senderExternalId === subscribedExternalId) {
    return { status: 'ignored' };
  }

  let channelSid: string | undefined;

  try {
    channelSid = await retrieveChannelFromUserChannelMap(context, {
      syncServiceSid,
      uniqueUserName,
    });

    if (!channelSid) {
      const newChannelSid = await createFlexChannel(context, {
        flexFlowSid,
        chatServiceSid,
        channelType,
        twilioNumber,
        chatFriendlyName,
        uniqueUserName,
        senderScreenName,
        onMessageSentWebhookUrl,
        onChannelUpdatedWebhookUrl,
      });

      channelSid = newChannelSid;
      await createUserChannelMap(context, {
        syncServiceSid,
        uniqueUserName,
        channelSid,
      });
    }
  } catch (err) {
    const removedStaleChannel = channelSid
      ? await removeChatChannel(context, { chatServiceSid, channelSid })
      : false;

    // Propagate the error
    if (err instanceof Error) {
      throw new Error(
        `Error while creating the new channel ${err.message}. Removed stale channel: ${removedStaleChannel}.`,
      );
    }

    throw err;
  }

  const response = await sendChatMessage(context, {
    chatServiceSid,
    channelSid,
    from: uniqueUserName,
    messageText,
    messageAttributes,
  });

  return { status: 'sent', response };
};

export type ChannelToFlex = {
  sendMessageToFlex: typeof sendMessageToFlex;
  retrieveChannelFromUserChannelMap: typeof retrieveChannelFromUserChannelMap;
  AseloCustomChannels: typeof AseloCustomChannels;
};
