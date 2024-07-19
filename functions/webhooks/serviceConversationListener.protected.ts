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

import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  // error400,
  error500,
  // success,
} from '@tech-matters/serverless-helpers';

export type ConversationSid = `CH${string}`;
export type ChatChannelSid = `CH${string}`;

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
    .conversations.conversations.get(conversationSid)
    .messages.create({
      body: messageText,
      author,
      xTwilioWebhookEnabled: 'true',
      ...(messageAttributes && { attributes: messageAttributes }),
    });

type ServiceConversationListenerEvent = {
  Body: string;
  Author: string;
  ParticipantSid?: string;
  ConversationSid: string;
  EventType: string;
  MessageSid: string;
  Attributes: any;
  From: string;
};

export type Body = ServiceConversationListenerEvent;

export const handler = async (context: Context, event: Body, callback: ServerlessCallback) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);
  try {
    const { Body, EventType, ConversationSid, MessageSid } = event;

    if (EventType === 'onMessageAdded') {
      console.log('EventType is here', Body, MessageSid, ConversationSid, event);

      context
        .getTwilioClient()
        .conversations.v1.conversations(ConversationSid)
        .messages(MessageSid)
        .fetch()
        .then((message) => {
          console.log('Message Body:', message.body);
          console.log('message:', message);
          console.log('Media:', message.media);
          console.log('Date Created:', message.dateCreated);
          console.log('Date Updated:', message.dateUpdated);
        })
        .catch((error) => {
          console.error('Error fetching message:', error);
        });
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
