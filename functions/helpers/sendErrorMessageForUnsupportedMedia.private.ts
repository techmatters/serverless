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

type SendErrorMessageForUnsupportedMediaEvent = {
  Body?: string;
  ConversationSid: ConversationSid;
  EventType?: string;
  Media?: Record<string, any>;
  DateCreated: Date;
};

export type Event = SendErrorMessageForUnsupportedMediaEvent;

const FALLBACK_ERROR_MESSAGE = 'Unsupported message type.';
const ERROR_MESSAGE_TRANSLATION_KEY = 'UnsupportedMediaErrorMsg';

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

export const sendErrorMessageForUnsupportedMedia = async (context: Context, event: Event) => {
  const { EventType, Body, Media, ConversationSid } = event;

  /* Valid message will have either a body/media. A message with no
     body or media implies that there was an error sending such message
  */
  if (EventType === 'onMessageAdded' && !Body && !Media) {
    let messageText = FALLBACK_ERROR_MESSAGE;

    const serviceConfig = await context.getTwilioClient().flexApi.configuration.get().fetch();
    const helplineLanguage = serviceConfig.attributes.helplineLanguage ?? 'en-US';

    if (helplineLanguage) {
      try {
        const response = await fetch(
          `https://${context.DOMAIN_NAME}/translations/${helplineLanguage}/messages.json`,
        );
        const translation = await response.json();
        const { [ERROR_MESSAGE_TRANSLATION_KEY]: translatedMessage } = translation;
        messageText = translatedMessage || messageText;
      } catch {
        console.warn(
          `Couldn't retrieve ${ERROR_MESSAGE_TRANSLATION_KEY} message translation for ${helplineLanguage}`,
        );
      }
    }

    await sendConversationMessage(context, {
      conversationSid: ConversationSid,
      author: 'Bot',
      messageText,
    });
  }
};

export type SendErrorMessageForUnsupportedMedia = typeof sendErrorMessageForUnsupportedMedia;
