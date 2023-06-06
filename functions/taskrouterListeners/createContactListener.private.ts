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
  TASK_CREATED,
} from '@tech-matters/serverless-helpers/taskrouter';

import type { AddCustomerExternalId } from '../helpers/addCustomerExternalId.private';
import type { AddTaskSidToChannelAttributes } from '../helpers/addTaskSidToChannelAttributes.private';

export const eventTypes: EventType[] = [TASK_CREATED];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

const isCreateContactTask = (
  eventType: EventType,
  taskAttributes: { isContactlessTask?: boolean },
) => eventType === TASK_CREATED && !taskAttributes.isContactlessTask;

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const { EventType: eventType, TaskAttributes: taskAttributesString } = event;

    console.log(`===== Executing CreateContactListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);

    if (isCreateContactTask(eventType, taskAttributes)) {
      console.log('Handling create contact...');

      // For offline contacts, this is already handled when the task is created in /assignOfflineContact function
      const handlerPath = Runtime.getFunctions()['helpers/addCustomerExternalId'].path;
      const addCustomerExternalId = require(handlerPath)
        .addCustomerExternalId as AddCustomerExternalId;
      await addCustomerExternalId(context, event);

      if (taskAttributes.channelType === 'web') {
        // Add task sid to tasksSids channel attr so we can end the chat from webchat client (see endChat function)
        const addTaskHandlerPath =
          Runtime.getFunctions()['helpers/addTaskSidToChannelAttributes'].path;
        const addTaskSidToChannelAttributes = require(addTaskHandlerPath)
          .addTaskSidToChannelAttributes as AddTaskSidToChannelAttributes;
        await addTaskSidToChannelAttributes(context, event);
      }

      console.log('Finished handling create contact.');
      return;
    }

    console.log('===== CreateContactListener finished successfully =====');
  } catch (err) {
    console.log('===== CreateContactListener has failed =====');
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
