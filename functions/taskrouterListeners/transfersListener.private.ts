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
  RESERVATION_ACCEPTED,
  RESERVATION_REJECTED,
  RESERVATION_TIMEOUT,
  RESERVATION_WRAPUP,
  TASK_CANCELED,
  TASK_QUEUE_ENTERED,
} from '@tech-matters/serverless-helpers/taskrouter';
import type { TransferMeta, ChatTransferTaskAttributes } from '../transfer/helpers.private';
import { InteractionChannelParticipants } from '../interaction/interactionChannelParticipants.private';
import { AdjustChatCapacityType } from '../adjustChatCapacity';

export const eventTypes: EventType[] = [
  RESERVATION_ACCEPTED,
  RESERVATION_REJECTED,
  RESERVATION_TIMEOUT,
  RESERVATION_WRAPUP,
  TASK_CANCELED,
  TASK_QUEUE_ENTERED,
];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const isChatTransfer = (
  taskChannelUniqueName: string,
  taskAttributes: { transferMeta?: TransferMeta },
) =>
  taskChannelUniqueName !== 'voice' &&
  taskAttributes.transferMeta &&
  taskAttributes.transferMeta.mode === 'COLD' &&
  taskAttributes.transferMeta.transferStatus === 'accepted';

const isChatTransferToWorkerAccepted = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: ChatTransferTaskAttributes,
) =>
  eventType === RESERVATION_ACCEPTED &&
  isChatTransfer(taskChannelUniqueName, taskAttributes) &&
  taskAttributes.transferTargetType === 'worker';

const isChatTransferToWorkerRejected = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: ChatTransferTaskAttributes,
) =>
  (eventType === RESERVATION_REJECTED ||
    eventType === RESERVATION_TIMEOUT ||
    eventType === TASK_CANCELED) &&
  isChatTransfer(taskChannelUniqueName, taskAttributes) &&
  taskAttributes.transferTargetType === 'worker';

const isChatTransferToQueueComplete = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: ChatTransferTaskAttributes,
) =>
  eventType === TASK_QUEUE_ENTERED &&
  isChatTransfer(taskChannelUniqueName, taskAttributes) &&
  taskAttributes.transferTargetType === 'queue';

const isWarmVoiceTransferRejected = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: { transferMeta?: TransferMeta },
) =>
  eventType === RESERVATION_REJECTED &&
  taskChannelUniqueName === 'voice' &&
  taskAttributes.transferMeta &&
  taskAttributes.transferMeta.mode === 'WARM';

const isVoiceTransferOriginalInWrapup = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: { transferMeta?: TransferMeta },
) =>
  eventType === RESERVATION_WRAPUP &&
  taskChannelUniqueName === 'voice' &&
  taskAttributes.transferMeta &&
  taskAttributes.transferMeta.transferStatus === 'accepted';

const isWarmVoiceTransferTimedOut = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: { transferMeta?: TransferMeta },
) =>
  eventType === RESERVATION_TIMEOUT &&
  taskChannelUniqueName === 'voice' &&
  taskAttributes.transferMeta &&
  taskAttributes.transferMeta.mode === 'WARM';

/**
 * updateWarmVoiceTransferAttributes is a DRY function that checks
 * when warm voice transfer gets rejected or timeout
 *
 * If a warm voice transfer gets rejected, it should:
 * 1) Adjust original task attributes:
 *    - transferMeta.transferStatus: 'rejected'
 *    - transferMeta.sidWithTaskControl: to original reservation
 * Same applies to when transfer timeout
 */
const updateWarmVoiceTransferAttributes = async (
  transferStatus: string,
  context: Context<EnvVars>,
  taskAttributes: { transferMeta: { originalReservation: string } },
  taskSid: string,
) => {
  console.info(`Handling warm voice transfer ${transferStatus} with taskSid ${taskSid}...`);

  const client = context.getTwilioClient();

  const updatedAttributes = {
    ...taskAttributes,
    transferMeta: {
      ...taskAttributes.transferMeta,
      sidWithTaskControl: taskAttributes.transferMeta.originalReservation,
      transferStatus,
    },
  };

  await client.taskrouter.workspaces
    .get(context.TWILIO_WORKSPACE_SID)
    .tasks.get(taskSid)
    .update({ attributes: JSON.stringify(updatedAttributes) });

  console.info(`Finished handling warm voice transfer ${transferStatus} with taskSid ${taskSid}.`);
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

const decreaseChatCapacity = async (context: Context<EnvVars>, taskSid: string) => {
  const serviceConfig = await context.getTwilioClient().flexApi.configuration.get().fetch();
  const {
    feature_flags: { enable_backend_manual_pulling: enableBackendManualPulling },
  } = serviceConfig.attributes;
  if (enableBackendManualPulling) {
    const task = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(taskSid);
    const reservations = await task.reservations.list();
    const workerSid = reservations.find((r) => r.reservationStatus === 'accepted')?.workerSid;

    if (!workerSid) {
      console.warn(`No worker found for task ${taskSid} to decrease chat capacity.`);
      return;
    }

    const { path } = Runtime.getFunctions().adjustChatCapacity;
    // eslint-disable-next-line global-require,import/no-dynamic-require,prefer-destructuring
    const adjustChatCapacity: AdjustChatCapacityType = require(path).adjustChatCapacity;

    const body = {
      workerSid,
      adjustment: 'decrease',
    } as const;

    await adjustChatCapacity(context, body);
  }
};

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const {
      EventType: eventType,
      TaskChannelUniqueName: taskChannelUniqueName,
      TaskSid: taskSid,
      TaskAttributes: taskAttributesString,
    } = event;

    console.log(`===== Executing TransfersListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);
    Object.entries(taskAttributes).forEach(([key, value]) => {
      console.log('Task attribute:', key, value);
    });

    /**
     * If a chat transfer gets accepted, it should:
     * 1) Complete the original task
     */
    if (isChatTransferToWorkerAccepted(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling chat transfer accepted...');

      const { originalTask: originalTaskSid } = taskAttributes.transferMeta;

      // We need to decrease chat capacity before completing the task, it until the task completed event introduces a race condition
      // The worker can still be offered another task before capacity is reduced if we don't do it now
      await decreaseChatCapacity(context, originalTaskSid);
      const client = context.getTwilioClient();

      await client.taskrouter.workspaces
        .get(context.TWILIO_WORKSPACE_SID)
        .tasks.get(originalTaskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'task transferred accepted',
        });

      /**
       * If conversation, remove original participant from conversation.
       */

      const { path } = Runtime.getFunctions()['interaction/interactionChannelParticipants'];
      // eslint-disable-next-line prefer-destructuring,global-require,import/no-dynamic-require
      const { transitionAgentParticipants }: InteractionChannelParticipants = require(path);
      await transitionAgentParticipants(
        context.getTwilioClient(),
        context.TWILIO_WORKSPACE_SID,
        originalTaskSid,
        'closed',
        taskAttributes.originalParticipantSid,
      );

      console.log('Finished handling chat transfer accepted.');
      return;
    }

    /**
     * If a chat transfer enters another queue, it should:
     * 1) Complete the original task
     */

    if (isChatTransferToQueueComplete(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling chat transfer to queue entering target queue...');

      const { originalTask: originalTaskSid } = taskAttributes.transferMeta;

      // We need to decrease chat capacity before completing the task, it until the task completed event introduces a race condition
      // The worker can still be offered another task before capacity is reduced if we don't do it now
      await decreaseChatCapacity(context, originalTaskSid);
      const client = context.getTwilioClient();

      await client.taskrouter.workspaces
        .get(context.TWILIO_WORKSPACE_SID)
        .tasks.get(originalTaskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'task transferred into queue',
        });

      /**
       * If conversation, remove original participant from conversation.
       */
      if (taskAttributes.originalParticipantSid) {
        try {
          const { path } = Runtime.getFunctions()['interaction/interactionChannelParticipants'];
          // eslint-disable-next-line prefer-destructuring,global-require,import/no-dynamic-require
          const { transitionAgentParticipants }: InteractionChannelParticipants = require(path);
          await transitionAgentParticipants(
            context.getTwilioClient(),
            context.TWILIO_WORKSPACE_SID,
            originalTaskSid,
            'closed',
            taskAttributes.originalParticipantSid,
          );
        } catch (err) {
          console.error(
            `Error closing original participant ${taskAttributes.originalParticipantSid} from interaction channel ${taskAttributes.conversationSid}`,
          );
        }
      }

      console.log('Finished handling chat queue transfer initiated.');
      return;
    }

    /**
     * If a chat transfer gets rejected, it should:
     * 1) Adjust original task attributes:
     *    - channelSid: from 'CH00000000000000000000000000000000' to original channelSid
     *    - transferMeta.sidWithTaskControl: to original reservation
     * 2) Adjust the transfer rejected task attributes
     *    - channelSid: from original channelSid to 'CH00000000000000000000000000000000'
     * 3) Cancel rejected task
     */
    if (isChatTransferToWorkerRejected(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling chat transfer to worker rejected...');

      const { originalTask: originalTaskSid } = taskAttributes.transferMeta;
      const client = context.getTwilioClient();
      const workspace = client.taskrouter.workspaces.get(context.TWILIO_WORKSPACE_SID);
      const [originalTask, rejectedTask] = await Promise.all([
        workspace.tasks.get(originalTaskSid).fetch(),
        workspace.tasks.get(taskSid).fetch(),
      ]);

      const { channelSid } = taskAttributes;

      const { attributes: attributesRaw } = originalTask;
      const originalAttributes = JSON.parse(attributesRaw);

      const transferMeta = {
        ...originalAttributes.transferMeta,
        sidWithTaskControl: originalAttributes.transferMeta.originalReservation,
        transferStatus: 'rejected',
      };

      const updatedOriginalTaskAttributes = {
        ...originalAttributes,
        transferMeta,
        channelSid,
      };

      const updatedRejectedTaskAttributes = {
        ...JSON.parse(rejectedTask.attributes),
        transferMeta,
        channelSid: 'CH00000000000000000000000000000000',
      };

      await Promise.all([
        originalTask.update({
          attributes: JSON.stringify(updatedOriginalTaskAttributes),
        }),
        rejectedTask.update({
          attributes: JSON.stringify(updatedRejectedTaskAttributes),
        }),
      ]);

      await rejectedTask.update({
        assignmentStatus: 'canceled',
        reason: 'task transferred rejected',
      });

      console.log('Finished handling chat transfer to worker rejected.');
      return;
    }

    if (isWarmVoiceTransferRejected(eventType, taskChannelUniqueName, taskAttributes)) {
      await updateWarmVoiceTransferAttributes('rejected', context, taskAttributes, taskSid);
      return;
    }

    if (isWarmVoiceTransferTimedOut(eventType, taskChannelUniqueName, taskAttributes)) {
      await updateWarmVoiceTransferAttributes('timeout', context, taskAttributes, taskSid);
      return;
    }

    /**
     * I'm not sure why Twilio is keeping the originalReservation in wrapup state
     * after a voice COLD transfer. This clause here completes this reservation.
     * Checks that transferStatus is 'accepted' to prevent rejected WARM transfers
     * to close the original task.
     */
    if (isVoiceTransferOriginalInWrapup(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling voice transfer wrapup...');

      const { originalTask: originalTaskSid, originalReservation } = taskAttributes.transferMeta;
      const client = context.getTwilioClient();

      await client.taskrouter.workspaces
        .get(context.TWILIO_WORKSPACE_SID)
        .tasks.get(originalTaskSid)
        .reservations(originalReservation)
        .update({ reservationStatus: 'completed' });

      console.log('Finished handling voice transfer wrapup.');
      return;
    }

    console.log('===== TransfersListener finished successfully =====');
  } catch (err) {
    console.log('===== TransfersListener has failed =====');
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
