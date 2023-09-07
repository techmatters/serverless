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
  channel,
  channelAttributes,
  memory: lexMemory,
  lexClient,
}: {
  context: Context<EnvVars>;
  channel: ChannelInstance;
  channelAttributes: { [k: string]: any };
  memory?: { [key: string]: string };
  lexClient: LexClient;
}) => {
  const memory = lexMemory || {};

  const capturedChannelAttributes =
    channelAttributes.capturedChannelAttributes as CapturedChannelAttributes;

  const releasedChannelAttributes = {
    ...omit(channelAttributes, ['capturedChannelAttributes']),
    ...(capturedChannelAttributes && capturedChannelAttributes.memoryAttribute
      ? { [capturedChannelAttributes.memoryAttribute]: memory }
      : { memory }),
    ...(capturedChannelAttributes &&
      capturedChannelAttributes.releaseFlag && {
        [capturedChannelAttributes.releaseFlag]: true,
      }),
  };

  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  await Promise.all([
    // Delete Lex session. This is not really needed as the session will expire, but that depends on the config of Lex.
    capturedChannelAttributes &&
      lexClient.deleteSession(context, {
        botName: capturedChannelAttributes.botName,
        botAlias: capturedChannelAttributes.botAlias,
        userId: channel.sid,
      }),
    // Update channel attributes (remove channelCapturedByBot and add memory)
    channel.update({
      attributes: JSON.stringify(releasedChannelAttributes),
    }),
    // Remove this webhook from the channel
    capturedChannelAttributes &&
      channel.webhooks().get(capturedChannelAttributes.chatbotCallbackWebhookSid).remove(),
    // Trigger the next step once the channel is released
    channelCaptureHandlers.handleChannelRelease(
      context,
      channel,
      capturedChannelAttributes,
      memory,
    ),
  ]);

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
      resolve(error400('Body'));
      return;
    }

    const client = context.getTwilioClient();
    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

    const lexClient = require(Runtime.getFunctions()['channelCapture/lexClient'].path) as LexClient;

    await chatbotCallbackCleanup({
      context,
      channel,
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
