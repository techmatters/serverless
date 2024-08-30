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
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import { ChatChannelJanitor } from './helpers/chatChannelJanitor.private';
import {
  ChatChannelSid,
  ConversationSid,
} from './helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
};

export type Body = {
  channelSid?: ChatChannelSid;
  conversationSid?: ConversationSid;
  language?: string;
  request: { cookies: {}; headers: {} };
};

type Messages = Required<{
  EndChatMsg: string;
}>;

const getEndChatMessage = async (event: Body, context: Context): Promise<string> => {
  // Retrieve the EndChatMsg for appropriate language
  const { language } = event;

  if (language) {
    try {
      const response = await fetch(
        `https://${context.DOMAIN_NAME}/translations/${language}/messages.json`,
      );
      const translation = await response.json();
      const { EndChatMsg } = translation as Messages;
      if (EndChatMsg) return EndChatMsg;
    } catch {
      console.warn(`Couldn't retrieve EndChatMsg message translation for ${language}`);
    }
  }
  return 'User left the conversation';
};

/**
 * End a task by updating their assignment status.
 *
 * It also sends a message indicating that the user has left the conversation
 * if appropriate.
 *
 * @returns channelCleanupRequired
 */
const updateTaskAssignmentStatus = async (
  taskSid: string,
  channelSid: string,
  context: Context<EnvVars>,
  event: Body,
) => {
  try {
    const client = context.getTwilioClient();
    // Fetch the Task to 'cancel' or 'wrapup'
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(taskSid)
      .fetch();

    // Send a Message indicating user left the conversation
    if (task.assignmentStatus === 'assigned') {
      const endChatMessage = await getEndChatMessage(event, context);
      await context
        .getTwilioClient()
        .chat.services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .messages.create({
          body: endChatMessage,
          from: 'Bot',
          xTwilioWebhookEnabled: 'true',
        });
    }

    // Update the task assignmentStatus
    const updateAssignmentStatus = (assignmentStatus: TaskInstance['assignmentStatus']) =>
      client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .update({ assignmentStatus });

    switch (task.assignmentStatus) {
      case 'reserved':
      case 'pending': {
        await updateAssignmentStatus('canceled');
        return 'cleanup'; // indicate that there's cleanup needed
      }
      case 'assigned': {
        await updateAssignmentStatus('wrapping');
        return 'keep-alive'; // keep the channel alive for post survey
      }
      default:
    }

    return 'noop'; // no action needed
  } catch (err) {
    console.warn(`Unable to end task ${taskSid}:`, err);
    return 'noop'; // no action needed
  }
};

/**
 * End contact task or post-survey task associated to the given channel.
 *
 * @returns channelCleanupRequired
 */
const endContactOrPostSurvey = async (
  channelAttributes: any,
  context: Context<EnvVars>,
  event: Body,
) => {
  const { tasksSids, surveyTaskSid } = channelAttributes;

  const { channelSid } = event;
  const actionsOnChannel = await Promise.allSettled(
    [...tasksSids, surveyTaskSid]
      .filter(Boolean)
      .map((tSid) => updateTaskAssignmentStatus(tSid, channelSid as string, context, event)),
  );

  // Cleanup the channel if there's no keep-alive and at least one cleanup
  const isChannelCleanupRequired =
    !actionsOnChannel.some((p) => p.status === 'fulfilled' && p.value === 'keep-alive') &&
    actionsOnChannel.some((p) => p.status === 'fulfilled' && p.value === 'cleanup');

  return isChannelCleanupRequired;
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const client = context.getTwilioClient();

      const { conversationSid, channelSid, language } = event;

      if (channelSid === undefined && conversationSid === undefined) {
        resolve(error400('Either a ChannelSid or ConversationSid parameter is required'));
        return;
      }
      if (language === undefined) {
        resolve(error400('language parameter is missing'));
        return;
      }

      let channelCleanupRequired = false;

      if (conversationSid) {
        const { attributes, participants } = await client.conversations
          .conversations(conversationSid)
          .fetch();
        const conversationAttributes = JSON.parse(attributes);
        channelCleanupRequired = await endContactOrPostSurvey(
          conversationAttributes,
          context,
          event,
        );
        const participantsList = await participants().list();
        await Promise.all(
          participantsList.map(async (p): Promise<boolean> => {
            if (JSON.parse(p.attributes).member_type !== 'guest') {
              return p.remove();
            }
            return false;
          }),
        );
      } else {
        const { members, attributes } = await client.chat
          .services(context.CHAT_SERVICE_SID)
          .channels(channelSid!)
          .fetch();
        // Use the channelSid to fetch task that needs to be closed
        const channelAttributes = JSON.parse(attributes);

        channelCleanupRequired = await endContactOrPostSurvey(channelAttributes, context, event);

        const channelMembers = await members().list();
        await Promise.all(
          channelMembers.map((m) => {
            if (JSON.parse(m.attributes).member_type !== 'guest') {
              return m.remove();
            }

            return Promise.resolve();
          }),
        );
      }

      if (channelCleanupRequired) {
        // Deactivate channel and proxy
        const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
        const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
        await chatChannelJanitor(context, { channelSid, conversationSid: conversationSid! });
      }

      resolve(success(JSON.stringify({ message: 'End Chat OK!' })));
      return;
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
