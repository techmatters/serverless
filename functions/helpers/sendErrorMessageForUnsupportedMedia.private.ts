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
export type ParticipantSid = `MB${string}`;

type SendErrorMessageForUnsupportedMediaEvent = {
  Body: string;
  ParticipantSid: ParticipantSid;
  ConversationSid: ConversationSid;
  EventType: string;
  Media: Record<string, any>;
  DateCreated: Date;
};

export type Event = SendErrorMessageForUnsupportedMediaEvent;

export const sendConversationMessage = async (
  context: Context,
  {
    conversationSid,
    author,
    messageText,
    messageAttributes,
    participantSid,
  }: {
    conversationSid: ConversationSid;
    author: string;
    messageText: string;
    messageAttributes?: Record<string, any>;
    participantSid: ParticipantSid;
  },
) =>
  context
    .getTwilioClient()
    .conversations.conversations(conversationSid)
    .messages.create({
      body: messageText,
      author,
      xTwilioWebhookEnabled: 'true',
      ...(messageAttributes && {
        attributes: JSON.stringify({
          ...(messageAttributes || {}),
          participantSid,
        }),
      }),
    });

const getTimeDifference = async (isoString: Date): Promise<string> => {
  const unitCheck = (count: number, unit: string) => (count > 1 ? `${unit}s` : unit);
  // Create a new Date object from the ISO string
  const givenDate = new Date(isoString);

  // Get the current date and time
  const currentDate = new Date();

  // Calculate the difference in milliseconds
  const differenceInMillis = currentDate.getTime() - givenDate.getTime();

  // Convert the difference to seconds
  const differenceInSeconds = Math.floor(differenceInMillis / 1000);
  const differenceInMinutes = Math.floor(differenceInSeconds / 60);

  // Determine whether to return the difference in seconds or minutes
  return differenceInSeconds < 60
    ? `${differenceInSeconds} ${unitCheck(differenceInSeconds, 'second')}`
    : `${differenceInMinutes} ${unitCheck(differenceInMinutes, 'minute')}`;
};

export const sendErrorMessageForUnsupportedMedia = async (context: Context, event: Event) => {
  const { EventType, Body, Media, ConversationSid, ParticipantSid, DateCreated } = event;

  if (EventType === 'onMessageAdded' && !Body && !Media) {
    const messageTime = await getTimeDifference(DateCreated);
    const messageText = `Sorry, your reaction sent ${messageTime} ago could not be delivered. Please send another message.`;

    await sendConversationMessage(context, {
      conversationSid: ConversationSid,
      author: 'Bot',
      messageText,
      participantSid: ParticipantSid,
    });
  }
};

export type SendErrorMessageForUnsupportedMedia = typeof sendErrorMessageForUnsupportedMedia;
