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

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import type { WebhookEvent } from '../helpers/customChannels/flexToCustomChannel.private';
import type { AWSCredentials, LexClient } from './lexClient.private';
import type { CapturedChannelAttributes } from './channelCaptureHandlers.private';
import type { ChatbotCallbackCleanupModule } from './chatbotCallbackCleanup.protected';

type EnvVars = AWSCredentials & {
  CHAT_SERVICE_SID: string;
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
  TWILIO_WORKSPACE_SID: string;
  HRM_STATIC_KEY: string;
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
  SURVEY_WORKFLOW_SID: string;
};

export type Body = Partial<WebhookEvent> & {};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('===== chatbotCallback handler =====');

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { Body, From, ChannelSid, EventType, Author, ConversationSid, ...rest } = event;
    console.log(JSON.stringify({ ConversationSid, rest }));
    if (!Body) {
      resolve(error400('Body'));
      return;
    }
    if (!From && !Author) {
      resolve(error400('From or Author'));
      return;
    }
    if (!ChannelSid && !ConversationSid) {
      resolve(error400('ChannelSid or ConversationSid'));
      return;
    }
    if (!EventType) {
      resolve(error400('EventType'));
      return;
    }

    const client = context.getTwilioClient();
    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(ChannelSid || String(ConversationSid))
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

    // Send message to bot only if it's from child
    if (
      (EventType === 'onMessageSent' || EventType === 'onMessageAdded') &&
      (channelAttributes.serviceUserIdentity === From ||
        channelAttributes.serviceUserIdentity === Author)
    ) {
      const lexClient = require(Runtime.getFunctions()['channelCapture/lexClient']
        .path) as LexClient;

      const capturedChannelAttributes =
        channelAttributes.capturedChannelAttributes as CapturedChannelAttributes;

      console.log('>> Post to Lex');
      console.log(JSON.stringify(capturedChannelAttributes));
      const lexResult = await lexClient.postText(context, {
        botName: capturedChannelAttributes.botName,
        botAlias: capturedChannelAttributes.botAlias,
        userId: capturedChannelAttributes.userId,
        inputText: Body,
      });
      console.log(JSON.stringify(lexResult));

      if (lexResult.status === 'failure') {
        console.log(lexResult.error.message);
        if (
          lexResult.error.message.includes(
            'Concurrent Client Requests: Encountered resource conflict while saving session data',
          )
        ) {
          console.log('Swallowed Concurrent Client Requests error');
          resolve(success('Swallowed Concurrent Client Requests error'));
          return;
        }

        throw lexResult.error;
      }

      const { lexResponse } = lexResult;
      // If the session ended, we should unlock the channel to continue the Studio Flow
      if (lexClient.isEndOfDialog(lexResponse.dialogState)) {
        const { chatbotCallbackCleanup } = require(Runtime.getFunctions()[
          'channelCapture/chatbotCallbackCleanup'
        ].path) as ChatbotCallbackCleanupModule;

        console.log('>> Chatbot callback cleanup');
        await chatbotCallbackCleanup({
          context,
          channel,
          channelAttributes,
          memory: lexResponse.slots,
          lexClient,
        });
      }

      // TODO: should send through conversation API?
      console.log('>> Send message to Flex');
      await channel.messages().create({
        body: lexResponse.message,
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });

      resolve(success('All messages sent :)'));
      return;
    }

    resolve(success('Event ignored'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
