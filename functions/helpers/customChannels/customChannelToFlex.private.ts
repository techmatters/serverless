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

import { Context } from '@twilio-labs/serverless-runtime-types/types';

export type ConversationSid = `CH${string}`;
export type ChatChannelSid = `CH${string}`;

/**
 * Cleans up the user channel map in Sync Service if the conversation is closed
 * This is a workaround because the ConversationStateUpdated webhook is not triggered when a conversation is closed
 * @param context
 * @param syncServiceSid
 * @param uniqueUserName
 * @param conversationSid
 */
async function cleanUpConversationInUserChannelMapIfClosed(
  context: Context,
  syncServiceSid: string,
  uniqueUserName: string,
  conversationSid: ConversationSid,
): Promise<boolean> {
  const twilioClient = context.getTwilioClient();
  // Check if the conversation is closed
  const conversation = await twilioClient.conversations.conversations(conversationSid).fetch();
  if (conversation.state === 'closed') {
    console.log(
      `Conversation ${conversationSid} is closed. It should have been removed from the map on closure. Removing it from the user channel map.`,
    );
    try {
      await twilioClient.sync.services(syncServiceSid).documents(uniqueUserName).remove();
    } catch (err) {
      if (err instanceof Error) {
        // If the error is that the doc was already cleaned, don't throw further
        const alreadyCleanedExpectedError = `The requested resource /Services/${syncServiceSid}/Documents/${uniqueUserName} was not found`;
        if (err.toString().includes(alreadyCleanedExpectedError)) return false;
      }

      throw err;
    }
    return true;
  }
  return false;
}

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
): Promise<ConversationSid | undefined> => {
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
 * @deprecated
 * We are replacing Twilio Programmable Chat with Twilio Conversations, so no new code should be written using this function.
 * This function will be removed in the future.
 * Use sendConversationMessage instead.
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
) =>
  context
    .getTwilioClient()
    .chat.services(chatServiceSid)
    .channels(channelSid)
    .messages.create({
      body: messageText,
      from,
      xTwilioWebhookEnabled: 'true',
      ...(messageAttributes && { attributes: messageAttributes }),
    });
/**
 * Sends a new message to the provided conversations channel
 */
export const sendConversationMessage = async (
  context: Context,
  {
    conversationSid,
    author,
    messageText,
    messageAttributes,
  }: {
    conversationSid: ConversationSid;
    author: string;
    messageText: string;
    messageAttributes?: string;
  },
) =>
  context
    .getTwilioClient()
    .conversations.conversations(conversationSid)
    .messages.create({
      body: messageText,
      author,
      xTwilioWebhookEnabled: 'true',
      ...(messageAttributes && { attributes: messageAttributes }),
    });

/**
 * @deprecated
 * We are replacing Twilio Programmable Chat with Twilio Conversations, so no new code should be using this function.
 * This function will be removed in the future.
 * Use removeConversation instead.
 */
export const removeChatChannel = async (
  context: Context,
  {
    chatServiceSid,
    channelSid,
  }: {
    chatServiceSid: string;
    channelSid: string;
  },
) => context.getTwilioClient().chat.services(chatServiceSid).channels(channelSid).remove();

export const removeConversation = async (
  context: Context,
  {
    conversationSid,
  }: {
    conversationSid: ConversationSid;
  },
) => context.getTwilioClient().conversations.conversations(conversationSid).remove();

export enum AseloCustomChannels {
  Twitter = 'twitter',
  Instagram = 'instagram',
  Line = 'line',
  Modica = 'modica',
}

export const isAseloCustomChannel = (s: unknown): s is AseloCustomChannels =>
  Object.values(AseloCustomChannels).includes(s as any);

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

type CreateFlexConversationParams = {
  studioFlowSid: string;
  channelType: AseloCustomChannels; // The chat channel being used
  twilioNumber: string; // The target Twilio number (usually have the shape <channel>:<id>, e.g. twitter:1234567)
  uniqueUserName: string; // Unique identifier for this user
  senderScreenName: string; // Friendly info to show to show in the Flex UI (like Twitter handle)
  onMessageSentWebhookUrl: string; // The url that must be used as the onMessageSent event webhook.
  onConversationUpdateWebhookUrl?: string; // The url that must be used as the onChannelUpdated event webhook. If not present, it defaults to https://${context.DOMAIN_NAME}/webhooks/FlexChannelUpdate
  conversationFriendlyName: string; // A name for the Flex conversation (typically same as uniqueUserName)
};

/**
 * @deprecated
 * We are replacing Twilio Programmable Chat with Twilio Conversations, so no new code should be using this function.
 * This function will be removed in the future.
 * Use createFlexConversation instead.
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
    (await client.chat.services(chatServiceSid).channels(channel.sid).fetch()).attributes,
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

/**
 * Creates a new Flex conversation in the provided Flex Flow and subscribes webhooks to it's events.
 * Adds to the channel attributes the provided twilioNumber used for routing.
 */
const createConversation = async (
  context: Context,
  {
    conversationFriendlyName,
    channelType,
    twilioNumber,
    uniqueUserName,
    senderScreenName,
    onMessageSentWebhookUrl,
    onConversationUpdateWebhookUrl,
    studioFlowSid,
  }: CreateFlexConversationParams,
): Promise<{ conversationSid: ConversationSid; error?: Error }> => {
  // const twilioNumber = `${twitterUniqueNamePrefix}${forUserId}`;

  const client = context.getTwilioClient();

  const conversationInstance = await client.conversations.conversations.create({
    xTwilioWebhookEnabled: 'true',
    friendlyName: conversationFriendlyName,
    uniqueName: `${channelType}/${uniqueUserName}/${Date.now()}`,
  });
  const conversationSid = conversationInstance.sid as ConversationSid;

  try {
    const conversationContext = await client.conversations.conversations(conversationSid);
    await conversationContext.participants.create({
      identity: uniqueUserName,
    });
    const channelAttributes = JSON.parse((await conversationContext.fetch()).attributes);

    console.log('channelAttributes prior to update', channelAttributes);

    await conversationContext.update({
      state: 'active',
      attributes: JSON.stringify({
        ...channelAttributes,
        channel_type: channelType,
        channelType,
        senderScreenName, // TODO: in Twitter this is "twitterUserHandle". Rework that in the UI when we use this
        twilioNumber,
      }),
    });

    await conversationContext.webhooks.create({
      target: 'studio',
      configuration: {
        flowSid: studioFlowSid,
        filters: ['onMessageAdded'],
      },
    });

    /* const onMessageAdded = */
    await conversationContext.webhooks.create({
      target: 'webhook',
      configuration: {
        method: 'POST',
        url: onMessageSentWebhookUrl,
        filters: ['onMessageAdded'],
      },
    });

    const stateWebhook = await conversationContext.webhooks.create({
      target: 'webhook',
      configuration: {
        method: 'POST',
        url:
          onConversationUpdateWebhookUrl ||
          `https://${context.DOMAIN_NAME}/webhooks/FlexChannelUpdate`,
        filters: ['onConversationUpdated'],
      },
    });
    console.log('onConversationStateUpdated Webhook added');
    Object.entries(stateWebhook).forEach(([key, value]) => {
      console.log(key, value);
    });
  } catch (err) {
    return { conversationSid, error: err as Error };
  }

  return { conversationSid };
};

type SendMessageToFlexParams = CreateFlexChannelParams & {
  syncServiceSid: string; // The Sync Service sid where user channel maps are stored
  messageText: string; // The body of the message to send
  messageAttributes?: string; // [optional] The message attributes
  senderExternalId: string; // The id in the external chat system of the user sending the message
  subscribedExternalId: string; // The id in the external chat system of the user that is subscribed to the webhook
};

type SendConversationMessageToFlexParams = CreateFlexConversationParams & {
  syncServiceSid: string; // The Sync Service sid where user channel maps are stored
  messageText: string; // The body of the message to send
  messageAttributes?: string; // [optional] The message attributes
  senderExternalId: string; // The id in the external chat system of the user sending the message
  subscribedExternalId: string; // The id in the external chat system of the user that is subscribed to the webhook
};

/**
 * @deprecated - We are migrating to Twilio conversations, so no new code should be using this function.
 * Use `sendConversationMessageToFlex` instead.
 *
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
      channelSid = await createFlexChannel(context, {
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
/**
 * Given a uniqueUserName, tries to send a message to the active chat channel for this user.
 * To retrieve the channel we do a lookup on the user channel map stored in Sync Service.
 * If the channel or the map does not exists, we create it here.
 * The uniqueUserName is typacally '<channelType>:<unique identifier of the sender>'
 *   (e.g. if the message is sent by Twitter user 1234567, the uniqueUserName will be 'twitter:1234567')
 */
export const sendConversationMessageToFlex = async (
  context: Context,
  {
    studioFlowSid,
    channelType,
    twilioNumber,
    uniqueUserName,
    senderScreenName,
    onMessageSentWebhookUrl,
    onConversationUpdateWebhookUrl,
    syncServiceSid,
    messageText,
    messageAttributes = undefined,
    senderExternalId,
    subscribedExternalId,
    conversationFriendlyName,
  }: SendConversationMessageToFlexParams,
): Promise<{ status: 'ignored' } | { status: 'sent'; response: any }> => {
  // Do not send messages that were sent by the receiverId (account subscribed to the webhook), as they were either sent from Flex or from the specific UI of the chat system
  if (senderExternalId === subscribedExternalId) {
    return { status: 'ignored' };
  }

  let conversationSid = await retrieveChannelFromUserChannelMap(context, {
    syncServiceSid,
    uniqueUserName,
  });

  if (conversationSid) {
    conversationSid = (await cleanUpConversationInUserChannelMapIfClosed(
      context,
      syncServiceSid,
      uniqueUserName,
      conversationSid,
    ))
      ? undefined
      : conversationSid;
  }

  if (!conversationSid) {
    const { conversationSid: newConversationSid, error } = await createConversation(context, {
      studioFlowSid,
      channelType,
      twilioNumber,
      uniqueUserName,
      senderScreenName,
      onMessageSentWebhookUrl,
      onConversationUpdateWebhookUrl,
      conversationFriendlyName,
    });

    if (error) {
      await removeConversation(context, {
        conversationSid: newConversationSid,
      });
      throw error;
    }

    await createUserChannelMap(context, {
      syncServiceSid,
      uniqueUserName,
      channelSid: newConversationSid,
    });

    conversationSid = newConversationSid;
  }

  const response = await sendConversationMessage(context, {
    conversationSid,
    author: uniqueUserName,
    messageText,
    messageAttributes,
  });

  return { status: 'sent', response };
};

export type ChannelToFlex = {
  sendMessageToFlex: typeof sendMessageToFlex;
  sendConversationMessageToFlex: typeof sendConversationMessageToFlex;
  retrieveChannelFromUserChannelMap: typeof retrieveChannelFromUserChannelMap;
  AseloCustomChannels: typeof AseloCustomChannels;
  isAseloCustomChannel: typeof isAseloCustomChannel;
};
