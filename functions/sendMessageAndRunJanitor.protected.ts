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
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
} from '@tech-matters/serverless-helpers';
import { Body, EnvVars as SendSystemEnv, SendSystemMessageModule } from './sendSystemMessage';
import { ChatChannelJanitor, EnvVars as JanitorEnv } from './helpers/chatChannelJanitor.private';

type EnvVars = SendSystemEnv & JanitorEnv;

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { channelSid, conversationSid } = event;

    if (channelSid === undefined && conversationSid === undefined) {
      resolve(error400('none of and channelSid provided, exactly one expected.'));
      return;
    }

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { sendSystemMessage } = require(Runtime.getFunctions().sendSystemMessage
      .path) as SendSystemMessageModule;

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
      .chatChannelJanitor as ChatChannelJanitor;

    if (conversationSid) {
      const conversationWebhooks = await context
        .getTwilioClient()
        .conversations.v1.conversations(conversationSid)
        .webhooks.list();

      // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
      await Promise.all(
        conversationWebhooks.map(async (w) => {
          if (w.target === 'studio') {
            await w.remove();
          }
        }),
      );

      // Send message
      const result = await sendSystemMessage(context, event);

      // Deactivate channel and proxy
      await chatChannelJanitor(context, { conversationSid });

      resolve(send(result.status)(result.message));
      return;
    }
    // TODO: remove once all accounts have been migrated to conversations
    if (channelSid) {
      const channelWebhooks = await context
        .getTwilioClient()
        .chat.services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .webhooks.list();

      // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
      await Promise.all(
        channelWebhooks.map(async (w) => {
          if (w.type === 'studio') {
            await w.remove();
          }
        }),
      );

      // Send message
      const result = await sendSystemMessage(context, event);

      // Deactivate channel and proxy
      await chatChannelJanitor(context, { channelSid });

      resolve(send(result.status)(result.message));
      return;
    }
  } catch (err: any) {
    resolve(error500(err));
  }
};
