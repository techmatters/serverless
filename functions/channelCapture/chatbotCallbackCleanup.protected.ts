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
};

export type Body = {
  channelSid: string;
};

export const chatbotCallbackCleanup = async ({
  context,
  channelOrConversation,
  channelAttributes,
  memory: lexMemory,
  lexClient,
}: {
  context: Context<EnvVars>;
  channelOrConversation: ChannelInstance | ConversationInstance;
  channelAttributes: { [k: string]: any };
  memory?: { [key: string]: string };
  lexClient: LexClient;
}) => {
  const memory = lexMemory || {};
  const { isConversation } = channelAttributes;
  console.log('>> isConversation', isConversation);

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

  const updateChannelOrConversationAttributes = (attributesObj: any) => {
    const attributes = JSON.stringify(attributesObj);

    if (isConversation) {
      (channelOrConversation as ConversationInstance).update({
        attributes,
      });
    } else {
      (channelOrConversation as ChannelInstance).update({
        attributes,
      });
    }
  };

  const removeWebhookFromChannelOrConversation = async () => {
    if (!capturedChannelAttributes.chatbotCallbackWebhookSid) return;

    console.log(
      '>> Removing webhook with id: ',
      capturedChannelAttributes.chatbotCallbackWebhookSid,
    );
    if (capturedChannelAttributes.chatbotCallbackWebhookSid) {
      console.log('>> Removing webhook from conversation');
      await (channelOrConversation as ConversationInstance)
        .webhooks()
        .get(capturedChannelAttributes.chatbotCallbackWebhookSid)
        .remove();
    } else {
      console.log('>> Removing webhook from programmable chat');
      await (channelOrConversation as ChannelInstance)
        .webhooks()
        .get(capturedChannelAttributes.chatbotCallbackWebhookSid)
        .remove();
    }
  };

  console.log('>> Before Promise.all');
  await Promise.all([
    // Delete Lex session. This is not really needed as the session will expire, but that depends on the config of Lex.
    capturedChannelAttributes?.botName &&
      capturedChannelAttributes?.botAlias &&
      lexClient.deleteSession(context, {
        botName: capturedChannelAttributes.botName,
        botAlias: capturedChannelAttributes.botAlias,
        userId: channelOrConversation.sid,
      }),
    // Update channel attributes (remove channelCapturedByBot and add memory)
    updateChannelOrConversationAttributes(releasedChannelAttributes),
    // Remove this webhook from the channel
    removeWebhookFromChannelOrConversation(),
    // Trigger the next step once the channel is released
    capturedChannelAttributes &&
      channelCaptureHandlers.handleChannelRelease(
        context,
        channelOrConversation,
        capturedChannelAttributes,
        memory,
      ),
  ]);
  console.log('>> After Promise.all');

  console.log('Channel unblocked and bot session deleted');
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

    const client = context.getTwilioClient();
    const conversation = await client.conversations.v1.conversations(channelSid).fetch();
    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .fetch();

    const channelOrConversation = conversation || channel;

    const channelAttributes = JSON.parse(channelOrConversation.attributes);

    const lexClient = require(Runtime.getFunctions()['channelCapture/lexClient'].path) as LexClient;

    await chatbotCallbackCleanup({
      context,
      channelOrConversation,
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
