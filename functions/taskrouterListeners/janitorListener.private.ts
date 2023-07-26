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
} from '@tech-matters/serverless-helpers/taskrouter';

import type { ChatChannelJanitor } from '../helpers/chatChannelJanitor.private';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';
import type { ChannelCaptureHandlers } from '../channelCapture/channelCaptureHandlers.private';
import type { ChatTransferTaskAttributes, TransferHelpers } from '../transfer/helpers.private';

export const eventTypes: EventType[] = [
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
];

type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

// This applies to both pre-survey(isChatCaptureControl) and post-survey
const isCleanupBotCapture = (
  eventType: EventType,
  taskAttributes: { isChatCaptureControl?: boolean },
) => {
  if (eventType === TASK_CANCELED) {
    const channelCaptureHandlers = require(Runtime.getFunctions()[
      'channelCapture/channelCaptureHandlers'
    ].path) as ChannelCaptureHandlers;
    return channelCaptureHandlers.isChatCaptureControlTask(taskAttributes);
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
  if (
    !(
      eventType === TASK_DELETED ||
      eventType === TASK_SYSTEM_DELETED ||
      eventType === TASK_CANCELED
    )
  ) {
    return false;
  }

  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  if (channelCaptureHandlers.isChatCaptureControlTask(taskAttributes)) {
    return false;
  }

  const transferHelers = require(Runtime.getFunctions()['transfer/helpers']
    .path) as TransferHelpers;

  if (!transferHelers.hasTaskControl(taskSid, taskAttributes)) {
    return false;
  }

  const channelToFlex = require(Runtime.getFunctions()['helpers/customChannels/customChannelToFlex']
    .path) as ChannelToFlex;

  return channelToFlex.isAseloCustomChannel(taskAttributes.channelType);
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
    const { EventType: eventType, TaskAttributes: taskAttributesString, TaskSid: taskSid } = event;

    console.log(`===== Executing JanitorListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);

    if (isCleanupBotCapture(eventType, taskAttributes)) {
      await wait(3000); // wait 3 seconds just in case some bot message is pending

      const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
        .chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

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
const transfersListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default transfersListener;
