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
import { omit } from 'lodash';
import type { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import type { ChannelInstance } from 'twilio/lib/rest/chat/v2/service/channel';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  success,
} from '@tech-matters/serverless-helpers';
import { ConversationInstance } from 'twilio/lib/rest/conversations/v1/conversation';
import twilio from 'twilio';
import type { AWSCredentials, LexClient } from './lexClient.private';
import type {
  CapturedChannelAttributes,
  ChannelCaptureHandlers,
} from './channelCaptureHandlers.private';

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
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
};

export type Body = {
  channelSid: string;
};

type ChatbotCallbackCleanupParams = {
  channel?: ChannelInstance;
  conversation?: ConversationInstance;

  context: Context<EnvVars>;
  channelAttributes: { [k: string]: any };
  memory?: { [key: string]: string };
  lexClient: LexClient;
};

export const chatbotCallbackCleanup = async ({
  context,
  channel,
  conversation,
  channelAttributes,
  memory: lexMemory,
  lexClient,
}: ChatbotCallbackCleanupParams) => {
  const memory = lexMemory || {};

  const capturedChannelAttributes =
    channelAttributes.capturedChannelAttributes as CapturedChannelAttributes;

  const releasedChannelAttributes = {
    ...omit(channelAttributes, ['capturedChannelAttributes']),
    ...(capturedChannelAttributes?.memoryAttribute
      ? { [capturedChannelAttributes.memoryAttribute]: memory }
      : { memory }),
    ...(capturedChannelAttributes?.releaseFlag && {
      [capturedChannelAttributes.releaseFlag]: true,
    }),
  };

  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  const updateChannelOrConversationAttributes = async (attributesObj: any) => {
    const attributes = JSON.stringify(attributesObj);

    if (conversation) {
      await conversation.update({
        attributes,
      });
    } else {
      await channel!.update({
        attributes,
      });
    }
  };

  const removeWebhookFromChannelOrConversation = async () => {
    if (!capturedChannelAttributes?.chatbotCallbackWebhookSid) {
      console.warn(
        'No chatbotCallbackWebhookSid found in capturedChannelAttributes for this conversation - looks like something went wrong setting up the chatbot.',
      );
      return;
    }

    if (conversation) {
      await conversation
        .webhooks()
        .get(capturedChannelAttributes.chatbotCallbackWebhookSid)
        .remove();
    } else if (channel) {
      await channel.webhooks().get(capturedChannelAttributes.chatbotCallbackWebhookSid).remove();
    }
  };

  await Promise.all([
    // Delete Lex session. This is not really needed as the session will expire, but that depends on the config of Lex.
    capturedChannelAttributes?.botName &&
      capturedChannelAttributes?.botAlias &&
      lexClient.deleteSession(context, {
        botName: capturedChannelAttributes.botName,
        botAlias: capturedChannelAttributes.botAlias,
        userId: (conversation ?? channel!).sid,
      }),
    // Update channel attributes (remove channelCapturedByBot and add memory)
    updateChannelOrConversationAttributes(releasedChannelAttributes),
    // Remove this webhook from the channel
    removeWebhookFromChannelOrConversation(),
    // Trigger the next step once the channel is released
    capturedChannelAttributes &&
      channelCaptureHandlers.handleChannelRelease(
        context,
        conversation ?? channel!,
        capturedChannelAttributes,
        memory,
      ),
  ]);
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('===== chatbotCallbackCleanup handler =====');

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { channelSid } = event;
    if (!channelSid) {
      resolve(error400('channelSid'));
      return;
    }

    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    let channel: ChannelInstance | undefined;
    const conversation = await client.conversations.v1.conversations(channelSid).fetch();

    if (!conversation) {
      channel = await client.chat.v2
        .services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .fetch();
    }

    const channelAttributes = JSON.parse((conversation || channel).attributes);

    const lexClient = require(Runtime.getFunctions()['channelCapture/lexClient'].path) as LexClient;

    await chatbotCallbackCleanup({
      context,
      channel,
      conversation,
      channelAttributes,
      lexClient,
    });

    resolve(success('All messages sent :)'));
    return;
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};

export type ChatbotCallbackCleanupModule = {
  chatbotCallbackCleanup: typeof chatbotCallbackCleanup;
};
