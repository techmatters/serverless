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

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

export type Body = {
  channelSid?: string;
  language?: string;
  request: { cookies: {}; headers: {} };
};

type Messages = {
  EndChatMsg: string;
};

const getEndChatMessage = (event: Body): string => {
  // Retrieve the EndChatMsg for appropriate language
  const { language } = event;

  if (language) {
    try {
      const translation: Messages = JSON.parse(
        Runtime.getAssets()[`/translations/${language}/messages.json`].open(),
      );
      const { EndChatMsg } = translation;
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
      const endChatMessage = getEndChatMessage(event);
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

      const { channelSid, language } = event;

      if (channelSid === undefined) {
        resolve(error400('ChannelSid parameter is missing'));
        return;
      }
      if (language === undefined) {
        resolve(error400('language parameter is missing'));
        return;
      }

      // Use the channelSid to fetch task that needs to be closed
      const channel = await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .fetch();
      const channelAttributes = JSON.parse(channel.attributes);

      const channelCleanupRequired = await endContactOrPostSurvey(
        channelAttributes,
        context,
        event,
      );

      const members = await channel.members().list();
      await Promise.all(
        members.map((m) => {
          if (JSON.parse(m.attributes).member_type !== 'guest') {
            return m.remove();
          }

          return Promise.resolve();
        }),
      );

      /** ==================== */
      /* TODO: Once all accounts are ready to manage triggering post survey on task wrap within taskRouterCallback, the following clean up can be removed */
      const serviceConfig = await client.flexApi.configuration.get().fetch();
      const { feature_flags: featureFlags } = serviceConfig.attributes;
      if (channelCleanupRequired || !featureFlags.post_survey_serverless_handled) {
        // Deactivate channel and proxy
        const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
        const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
        await chatChannelJanitor(context, { channelSid });
      }
      /** ==================== */

      resolve(success(JSON.stringify({ message: 'End Chat OK!' })));
      return;
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
