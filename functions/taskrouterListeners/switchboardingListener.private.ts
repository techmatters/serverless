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
import { Context } from '@twilio-labs/serverless-runtime-types/types';

import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_CREATED,
  TASK_QUEUE_ENTERED,
  TASK_QUEUE_MOVED,
  TASK_UPDATED,
} from '@tech-matters/serverless-helpers/taskrouter';

export const eventTypes: EventType[] = [
  TASK_CREATED,
  TASK_QUEUE_ENTERED,
  TASK_QUEUE_MOVED,
  TASK_UPDATED,
];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

/**
 * Add a flag to tasks that are being handled by the switchboarding system
 * This ensures we can identify these tasks later for proper routing
 */
const markTaskForSwitchboarding = async (
  context: Context<EnvVars>,
  taskSid: string,
  attributes: any,
) => {
  const client = context.getTwilioClient();
  const updatedAttributes = {
    ...attributes,
    switchboardingHandled: true,
    switchboardingTimestamp: new Date().toISOString(),
  };

  await client.taskrouter.v1.workspaces
    .get(context.TWILIO_WORKSPACE_SID)
    .tasks.get(taskSid)
    .update({ attributes: JSON.stringify(updatedAttributes) });

  console.log(`Task ${taskSid} marked for switchboarding`);
};

/**
 * Check if the task is being transferred back to the original queue
 * This is important for allowing supervisors to transfer calls back
 * to the original queue without having them bounce to switchboard
 */
const isTransferBackToOriginal = (taskAttributes: any, queueSid: string): boolean => {
  // Check if the task was previously handled by switchboarding
  if (!taskAttributes.switchboardingHandled) {
    return false;
  }

  // Check if this is a transfer operation
  if (!taskAttributes.transferMeta) {
    return false;
  }

  // Check if the queue is the original queue that had switchboarding enabled
  // In a real implementation, we would fetch this from a persistent storage
  // but for now, we'll use the queueSid parameter that was passed in
  console.log(`Checking if queue ${queueSid} is the original queue for switchboarding exemption`);

  // For now, any transfer from a switchboarded task will be exempt
  // In a more complete implementation, we would check that this specific queue
  // was the original queue that had switchboarding enabled
  return true;
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const { EventType: eventType, TaskSid: taskSid, TaskAttributes: taskAttributesString } = event;

    console.log(`===== Executing SwitchboardingListener for event: ${eventType} =====`);

    // Parse the task attributes
    const taskAttributes = JSON.parse(taskAttributesString);

    // Get queue SID from task attributes instead of from event directly
    const taskQueueSid = taskAttributes.taskQueueSid || taskAttributes.task_queue_sid;

    // Log key attributes for debugging
    console.log(`Task ${taskSid} entering queue ${taskQueueSid || 'unknown'}`);
    console.log(
      `Task attributes: ${JSON.stringify({
        callSid: taskAttributes.call_sid,
        direction: taskAttributes.direction,
        transferMeta: taskAttributes.transferMeta,
        switchboardingHandled: taskAttributes.switchboardingHandled,
      })}`,
    );

    // If this is a new task entering the Switchboard Queue and isn't already marked
    if (
      (eventType === TASK_QUEUE_ENTERED || eventType === TASK_QUEUE_MOVED) &&
      !taskAttributes.switchboardingHandled
    ) {
      // Fetch the queue to check if it's the switchboard queue
      const client = context.getTwilioClient();

      // If we have a queue SID in the attributes, use it to look up the queue
      if (taskQueueSid) {
        const queue = await client.taskrouter.v1.workspaces
          .get(context.TWILIO_WORKSPACE_SID)
          .taskQueues(taskQueueSid)
          .fetch();

        if (queue.friendlyName === 'Switchboard Queue') {
          await markTaskForSwitchboarding(context, taskSid, taskAttributes);
          console.log('Task marked for switchboarding handling');
        }
      } else {
        console.log(
          'TaskQueueSid not found in task attributes, cannot determine if this is a switchboard queue',
        );
      }
    }

    // Handle transfers specifically to prevent bouncing back to switchboard
    if (eventType === TASK_UPDATED) {
      // For task updates, check if this is a transfer back to original queue
      // Note: Since TaskQueueSid may not be directly available on task update events,
      // we need to extract it from attributes or determine it from other properties
      const targetQueueSid =
        taskAttributes.taskQueueSid || taskAttributes.task_queue_sid || taskAttributes.targetSid;

      if (targetQueueSid && isTransferBackToOriginal(taskAttributes, targetQueueSid)) {
        // If this is a transfer back to original queue, mark it as a special transfer
        // to prevent it from bouncing back to the switchboard queue
        const client = context.getTwilioClient();
        const updatedAttributes = {
          ...taskAttributes,
          switchboardingTransferExempt: true,
          switchboardingTransferTimestamp: new Date().toISOString(),
        };

        await client.taskrouter.v1.workspaces
          .get(context.TWILIO_WORKSPACE_SID)
          .tasks.get(taskSid)
          .update({ attributes: JSON.stringify(updatedAttributes) });

        console.log(`Task ${taskSid} marked as exempt from switchboarding redirection`);
      }
    }
  } catch (err) {
    console.error('Error in SwitchboardingListener:', err);
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
export default {
  shouldHandle,
  handleEvent,
} as TaskrouterListener;
