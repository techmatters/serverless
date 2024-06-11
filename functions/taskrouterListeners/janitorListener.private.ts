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
import { Context } from '@twilio-labs/serverless-runtime-types/types';

import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
  TASK_COMPLETED,
} from '@tech-matters/serverless-helpers/taskrouter';

import type { ChatChannelJanitor } from '../helpers/chatChannelJanitor.private';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';
import type { ChannelCaptureHandlers } from '../channelCapture/channelCaptureHandlers.private';
import type { ChatTransferTaskAttributes, TransferHelpers } from '../transfer/helpers.private';

export const eventTypes: EventType[] = [
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_COMPLETED,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
];

type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
};

// This applies to both pre-survey(isChatCaptureControl) and post-survey
const isCleanupBotCapture = (
  eventType: EventType,
  taskAttributes: { isChatCaptureControl?: boolean },
) => {
  if (eventType !== TASK_CANCELED) {
    return false;
  }

  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  return channelCaptureHandlers.isChatCaptureControlTask(taskAttributes);
};

const isHandledByOtherListener = (
  taskSid: string,
  taskAttributes: {
    channelType?: string;
    isChatCaptureControl?: boolean;
  } & ChatTransferTaskAttributes,
) => {
  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  if (channelCaptureHandlers.isChatCaptureControlTask(taskAttributes)) {
    return true;
  }

  const transferHelpers = require(Runtime.getFunctions()['transfer/helpers']
    .path) as TransferHelpers;

  if (!transferHelpers.hasTaskControl(taskSid, taskAttributes)) {
    return true;
  }

  return false;
};

const isCleanupCustomChannel = (
  eventType: EventType,
  taskSid: string,
  taskAttributes: {
    channelType?: string;
    isChatCaptureControl?: boolean;
  } & ChatTransferTaskAttributes,
) => {
  if (![TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].includes(eventType)) {
    return false;
  }

  if (isHandledByOtherListener(taskSid, taskAttributes)) {
    return false;
  }

  const channelToFlex = require(Runtime.getFunctions()['helpers/customChannels/customChannelToFlex']
    .path) as ChannelToFlex;

  return channelToFlex.isAseloCustomChannel(taskAttributes.channelType);
};

const isDeactivateConversationOrchestration = (
  eventType: EventType,
  taskSid: string,
  taskAttributes: {
    channelType?: string;
    isChatCaptureControl?: boolean;
  } & ChatTransferTaskAttributes,
) => {
  if (
    ![TASK_WRAPUP, TASK_COMPLETED, TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].includes(
      eventType,
    )
  ) {
    return false;
  }

  if (isHandledByOtherListener(taskSid, taskAttributes)) {
    return false;
  }

  return true;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const {
      EventType: eventType,
      TaskAttributes: taskAttributesString,
      TaskSid: taskSid,
      TaskChannelUniqueName: taskChannelUniqueName,
    } = event;

    // The janitor is only be executed for chat based tasks
    if (!['chat', 'survey'].includes(taskChannelUniqueName)) return;

    console.log(`===== Executing JanitorListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString || '{}');
    const { channelSid, conversationSid } = taskAttributes;

    if (taskChannelUniqueName === 'survey' && (!conversationSid || eventType !== TASK_CANCELED)) {
      console.log(
        'Survey tasks are only handled by the channel janitor if they are cancelled events for conversations tasks - skipping this one.',
        eventType,
        conversationSid,
      );
      return;
    }

    if (isCleanupBotCapture(eventType, taskAttributes)) {
      await wait(3000); // wait 3 seconds just in case some bot message is pending

      const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
        .chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid, conversationSid });

      console.log('Finished handling clean up.');

      return;
    }

    if (isCleanupCustomChannel(eventType, taskSid, taskAttributes)) {
      console.log('Handling clean up custom channel...');

      const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
        .chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

      console.log('Finished handling clean up custom channel.');
      return;
    }

    if (isDeactivateConversationOrchestration(eventType, taskSid, taskAttributes)) {
      // This task has reached a point where the channel should be deactivated, unless post survey is enabled
      const client = context.getTwilioClient();
      const serviceConfig = await client.flexApi.configuration.get().fetch();
      const { feature_flags: featureFlags } = serviceConfig.attributes;

      if (!featureFlags.enable_post_survey) {
        console.log('Handling DeactivateConversationOrchestration...');

        const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor']
          .path).chatChannelJanitor as ChatChannelJanitor;
        await chatChannelJanitor(context, {
          channelSid,
          conversationSid,
        });

        console.log('Finished DeactivateConversationOrchestration.');
        return;
      }
    }

    console.log('===== JanitorListener finished successfully =====');
  } catch (err) {
    console.log('===== JanitorListener has failed =====');
    console.log(String(err));
    throw err;
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const janitorListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default janitorListener;
