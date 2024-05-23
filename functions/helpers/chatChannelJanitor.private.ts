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

/**
 * In order to make post surveys work, we need to disable the Channel Janitor (see https://www.twilio.com/docs/flex/developer/messaging/manage-flows#channel-janitor).
 * However, once the post survey is finished we want to mimic this feature to clear the channel and the proxy session, to enable future conversations from the same customer
 * Ths file exposes functionalities to achieve this. chatChannelJanitor will:
 * - Label the chat channel as INACTIVE.
 * - Delete the associated proxy session if there is one.
 */

// eslint-disable-next-line prettier/prettier
import type { Context } from '@twilio-labs/serverless-runtime-types/types';
import { ChatChannelSid, ConversationSid } from './customChannels/customChannelToFlex.private';

export type Event =
  | {
      channelSid?: ChatChannelSid;
      conversationSid: ConversationSid;
    }
  | {
      channelSid: ChatChannelSid;
      conversationSid?: ConversationSid;
    };

export type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const deleteProxySession = async (context: Context<EnvVars>, proxySession: string) => {
  try {
    const client = context.getTwilioClient();
    const ps = await client.proxy
      .services(context.FLEX_PROXY_SERVICE_SID)
      .sessions(proxySession)
      .fetch();

    if (!ps) {
      // eslint-disable-next-line no-console
      console.log(`Tried to remove proxy session ${proxySession} but couldn't find it.`);
      return false;
    }

    const removed = await ps.remove();

    return removed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log('deleteProxySession error: ', err);
    return false;
  }
};

const deactivateChannel = async (
  context: Context<EnvVars>,
  serviceSid: string,
  channelSid: ChatChannelSid,
) => {
  const client = context.getTwilioClient();

  const channel = await client.chat.services(serviceSid).channels(channelSid).fetch();

  const attributes = JSON.parse(channel.attributes);

  if (attributes.status !== 'INACTIVE') {
    if (attributes.proxySession) {
      await deleteProxySession(context, attributes.proxySession);
    }

    const newAttributes = { ...attributes, status: 'INACTIVE' };
    const updated = await channel.update({
      attributes: JSON.stringify(newAttributes),
      xTwilioWebhookEnabled: 'true',
    });

    return { message: 'Channel deactivated', updated };
  }

  return { message: 'Channel already INACTIVE, event ignored' };
};

const deactivateConversation = async (
  context: Context<EnvVars>,
  conversationSid: ConversationSid,
) => {
  const client = context.getTwilioClient();

  const conversation = await client.conversations.v1.conversations(conversationSid).fetch();
  const attributes = JSON.parse(conversation.attributes);

  console.log('conversation attributes', ...Object.entries(attributes));

  if (attributes.status !== 'INACTIVE') {
    if (attributes.proxySession) {
      await deleteProxySession(context, attributes.proxySession);
    }

    const newAttributes = { ...attributes, status: 'INACTIVE' };
    const updated = await conversation.update({
      attributes: JSON.stringify(newAttributes),
      xTwilioWebhookEnabled: 'true',
    });

    return { message: 'Conversation deactivated', updated };
  }

  return { message: 'Channel already INACTIVE, event ignored' };
};

export const chatChannelJanitor = async (
  context: Context<EnvVars>,
  { channelSid, conversationSid }: Event,
) => {
  if (conversationSid) {
    const result = await deactivateConversation(context, conversationSid);

    return { message: `Deactivation attempted for conversation ${conversationSid}`, result };
  }
  const result = await deactivateChannel(context, context.CHAT_SERVICE_SID, channelSid);

  return { message: `Deactivation attempted for channel ${channelSid}`, result };
};

export type ChatChannelJanitor = typeof chatChannelJanitor;
