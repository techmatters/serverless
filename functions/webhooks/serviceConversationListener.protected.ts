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
import { responseWithCors, bindResolve, error500 } from '@tech-matters/serverless-helpers';

export type ConversationSid = `CH${string}`;
export type ParticipantSid = `MB${string}`;

type ServiceConversationListenerEvent = {
  Body: string;
  ParticipantSid: ParticipantSid;
  ConversationSid: ConversationSid;
  EventType: string;
  MessageSid: string;
};

export type Body = ServiceConversationListenerEvent;

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

const getTimeDifference = async (isoString: Date): Promise<string> => {
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
    ? `${differenceInSeconds} seconds`
    : `${differenceInMinutes} minutes`;
};

export const handler = async (context: Context, event: Body, callback: ServerlessCallback) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);
  try {
    const { EventType, ConversationSid, MessageSid, ParticipantSid, Body } = event;

    let messageAuthor: string | undefined;

    // check if it's the onMessageAdded event
    if (EventType === 'onMessageAdded') {
      const conversationMessage = await context
        .getTwilioClient()
        .conversations.v1.conversations(ConversationSid)
        .messages(MessageSid)
        .fetch();

      const participantsList = await context
        .getTwilioClient()
        .conversations.v1.conversations(ConversationSid)
        .participants.list();

      participantsList.forEach((participant) => {
        if (participant.sid !== conversationMessage.participantSid) {
          // The message author has to be the participant receiving the message (counsellor) not the sender
          messageAuthor = participant.identity;
        }
      });

      if (
        ParticipantSid === conversationMessage.participantSid &&
        !conversationMessage.media &&
        !Body
      ) {
        const messageTime = await getTimeDifference(conversationMessage.dateCreated);
        const messageText = `Sorry, your reaction sent ${messageTime} could not be delivered.`;

        await sendConversationMessage(context, {
          conversationSid: ConversationSid,
          author: messageAuthor ?? '',
          messageText,
        });
      }
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
