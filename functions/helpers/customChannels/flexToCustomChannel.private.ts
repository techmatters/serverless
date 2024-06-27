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

export type ProgrammableChatWebhookEvent = {
  Body: string;
  From: string;
  ChannelSid: string;
  EventType: string;
  Source: string;
};

export type ConversationWebhookEvent = {
  Body: string;
  Author: string;
  ParticipantSid?: string;
  ConversationSid: string;
  EventType: string;
  Source: string;
};

export type ExternalSendResult = {
  ok: boolean;
  meta: Record<string, string>;
  body: any;
  resultCode: number;
};

export type WebhookEvent = ConversationWebhookEvent | ProgrammableChatWebhookEvent;

type Params<T extends WebhookEvent, TResponse = any> = {
  event: T;
  recipientId: string;
  sendExternalMessage: (recipientId: string, messageText: string) => Promise<TResponse>;
};

export const isConversationWebhookEvent = (
  event: WebhookEvent,
): event is ConversationWebhookEvent => 'ConversationSid' in event;

export type RedirectResult = { status: 'ignored' } | { status: 'sent'; response: any };

export const redirectMessageToExternalChat = async (
  context: Context<{ CHAT_SERVICE_SID: string }>,
  { event, recipientId, sendExternalMessage }: Params<ProgrammableChatWebhookEvent>,
): Promise<RedirectResult> => {
  const { Body, ChannelSid, EventType, From, Source } = event;

  if (Source === 'SDK') {
    const response = await sendExternalMessage(recipientId, Body);
    return { status: 'sent', response };
  }

  if (Source === 'API' && EventType === 'onMessageSent') {
    const client = context.getTwilioClient();
    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(ChannelSid)
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

    // Redirect bot, system or third participant, but not self
    if (channelAttributes.from !== From) {
      const response = await sendExternalMessage(recipientId, Body);
      return { status: 'sent', response };
    }
  }

  // This ignores self messages and not supported sources
  return { status: 'ignored' };
};

export const redirectConversationMessageToExternalChat = async (
  context: Context,
  { event, recipientId, sendExternalMessage }: Params<ConversationWebhookEvent, ExternalSendResult>,
): Promise<RedirectResult> => {
  const { Body, ConversationSid, EventType, ParticipantSid, Source } = event;
  let shouldSend = false;
  if (Source === 'SDK') {
    shouldSend = true;
  } else if (Source === 'API' && EventType === 'onMessageAdded') {
    const client = context.getTwilioClient();
    const conversation = await client.conversations.v1.conversations.get(ConversationSid).fetch();
    const { attributes: attributesString } = conversation;
    const attributes = JSON.parse(attributesString);
    console.log('Conversation attributes:');
    Object.entries(attributes).forEach(([key, value]) => {
      console.log(`${key}:`, value);
    });

    const { participantSid } = attributes;

    // Redirect bot, system or third participant, but not self
    shouldSend = participantSid && participantSid !== ParticipantSid;
  }
  if (shouldSend) {
    const response = await sendExternalMessage(recipientId, Body);
    if (response.ok) {
      return { status: 'sent', response };
    }
    console.log(`Failed to send message: ${response.resultCode}`, response.body, response.meta);
    throw new Error(`Failed to send message: ${response.resultCode}`);
  }
  // This ignores self messages and not supported sources
  return { status: 'ignored' };
};

export type FlexToCustomChannel = {
  redirectMessageToExternalChat: typeof redirectMessageToExternalChat;
  redirectConversationMessageToExternalChat: typeof redirectConversationMessageToExternalChat;
  isConversationWebhookEvent: typeof isConversationWebhookEvent;
};
