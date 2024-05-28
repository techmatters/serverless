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

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  functionValidator as TokenValidator,
  send,
} from '@tech-matters/serverless-helpers';
import {
  ConversationSid,
  ChatChannelSid,
} from './helpers/customChannels/customChannelToFlex.private';

export type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

export type Body = (
  | {
      channelSid: ChatChannelSid;
      conversationSid?: ConversationSid;
      taskSid?: string;
    }
  | {
      channelSid?: ChatChannelSid;
      conversationSid: ConversationSid;
      taskSid?: string;
    }
  | {
      channelSid?: ChatChannelSid;
      conversationSid?: ConversationSid;
      taskSid: string;
    }
) & {
  message?: string;
  from?: string;
  request: { cookies: {}; headers: {} };
};

export const sendSystemMessage = async (context: Context<EnvVars>, event: Body) => {
  const { taskSid, channelSid, conversationSid, message, from } = event;

  console.log('------ sendSystemMessage excecution ------');

  if (!channelSid && !taskSid && !conversationSid) {
    return {
      status: 400,
      message: 'none of taskSid and channelSid provided, exactly one expected.',
    };
  }

  if (message === undefined) {
    return { status: 400, message: 'missing message.' };
  }

  const client = context.getTwilioClient();

  let channelSidToMessage = null;
  let conversationSidToMessage = null;

  if (channelSid) {
    channelSidToMessage = channelSid;
  } else if (conversationSid) {
    conversationSidToMessage = conversationSid;
  } else if (taskSid) {
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    const taskAttributes = JSON.parse(task.attributes);
    const { channelSid: taskChannelSid, conversationSid: taskConversationSid } = taskAttributes;

    channelSidToMessage = taskChannelSid;
    conversationSidToMessage = taskConversationSid;
  }

  if (conversationSidToMessage) {
    console.log(`Adding message "${message} to conversation ${conversationSidToMessage}"`);

    const messageResult = await context
      .getTwilioClient()
      .conversations.conversations(conversationSidToMessage)
      .messages.create({
        body: message,
        author: from,
        xTwilioWebhookEnabled: 'true',
      });

    return { status: 200, message: messageResult };
  }
  if (channelSidToMessage) {
    console.log(`Sending message "${message} to channel ${channelSidToMessage}"`);

    const messageResult = await context
      .getTwilioClient()
      .chat.services(context.CHAT_SERVICE_SID)
      .channels(channelSidToMessage)
      .messages.create({
        body: message,
        from,
        xTwilioWebhookEnabled: 'true',
      });

    return { status: 200, message: messageResult };
  }
  return {
    status: 400,
    message:
      'Conversation or Chat Channel SID were not provided directly or specified on the provided task',
  };
};

export type SendSystemMessageModule = {
  sendSystemMessage: typeof sendSystemMessage;
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const result = await sendSystemMessage(context, event);

      resolve(send(result.status)(result.message));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
