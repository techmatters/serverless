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

export type WebhookEvent = {
  Body: string;
  From: string;
  Author: string;
  ChannelSid: string;
  EventType: string;
  Source: string;
};

type Params = {
  event: WebhookEvent;
  recipientId: string;
  sendExternalMessage: (recipientId: string, messageText: string) => Promise<any>;
};

export const redirectMessageToExternalChat = async (
  context: Context<{ CHAT_SERVICE_SID: string }>,
  { event, recipientId, sendExternalMessage }: Params,
): Promise<{ status: 'ignored' } | { status: 'sent'; response: any }> => {
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

export type FlexToCustomChannel = {
  redirectMessageToExternalChat: typeof redirectMessageToExternalChat;
};
