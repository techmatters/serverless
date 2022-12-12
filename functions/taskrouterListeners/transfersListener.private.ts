/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
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
  TASK_QUEUE_ENTERED,
} from '@tech-matters/serverless-helpers/taskrouter';

export const eventTypes: EventType[] = [
  RESERVATION_ACCEPTED,
  RESERVATION_REJECTED,
  RESERVATION_TIMEOUT,
  RESERVATION_WRAPUP,
  TASK_QUEUE_ENTERED,
];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type TransferMeta = {
  mode: 'COLD' | 'WARM';
  transferStatus: 'transferring' | 'accepted' | 'rejected';
};

type ChatTransferTaskAttributes = {
  transferMeta?: TransferMeta;
  transferTargetType: 'worker' | 'queue';
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
  (eventType === RESERVATION_REJECTED || eventType === RESERVATION_TIMEOUT) &&
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

const isVoiceTransferWrapup = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: { transferMeta?: TransferMeta },
) =>
  eventType === RESERVATION_WRAPUP &&
  taskChannelUniqueName === 'voice' &&
  taskAttributes.transferMeta;

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

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

    /**
     * If a chat transfer gets accepted, it should:
     * 1) Complete the original task
     */
    if (isChatTransferToWorkerAccepted(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling chat transfer accepted...');

      const { originalTask: originalTaskSid } = taskAttributes.transferMeta;
      const client = context.getTwilioClient();

      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(originalTaskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'task transferred accepted',
        });

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
      const client = context.getTwilioClient();

      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(originalTaskSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'task transferred into queue',
        });

      console.log('Finished handling chat queue transfer.');
      return;
    }

    /**
     * If a chat transfer gets rejected, it should:
     * 1) Adjust original task attributes:
     *    - channelSid: from 'CH00000000000000000000000000000000' to original channelSid
     *    - transferMeta.sidWithTaskControl: to original reservation
     * 2) Cancel rejected task
     */
    if (isChatTransferToWorkerRejected(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling chat transfer rejected...');

      const { originalTask: originalTaskSid } = taskAttributes.transferMeta;
      const client = context.getTwilioClient();

      const originalTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(originalTaskSid)
        .fetch();

      const { attributes: attributesRaw } = originalTask;
      const originalAttributes = JSON.parse(attributesRaw);

      const { channelSid } = taskAttributes;
      const attributesWithChannelSid = {
        ...originalAttributes,
        channelSid,
        transferMeta: {
          ...originalAttributes.transferMeta,
          sidWithTaskControl: originalAttributes.transferMeta.originalReservation,
        },
      };

      await Promise.all([
        client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(originalTaskSid)
          .update({
            attributes: JSON.stringify(attributesWithChannelSid),
          }),
        client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).tasks(taskSid).update({
          assignmentStatus: 'canceled',
          reason: 'task transferred rejected',
        }),
      ]);

      console.log('Finished handling chat transfer rejected.');
      return;
    }

    /**
     * If a warm voice transfer gets rejected, it should:
     * 1) Adjust original task attributes:
     *    - transferMeta.transferStatus: 'rejected'
     *    - transferMeta.sidWithTaskControl: to original reservation
     */
    if (isWarmVoiceTransferRejected(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling warm voice transfer rejected...');

      const client = context.getTwilioClient();

      const updatedAttributes = {
        ...taskAttributes,
        transferMeta: {
          ...taskAttributes.transferMeta,
          sidWithTaskControl: taskAttributes.transferMeta.originalReservation,
          transferStatus: 'rejected',
        },
      };

      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .update({
          attributes: JSON.stringify(updatedAttributes),
        });

      console.log('Finished handling warm voice transfer rejected.');
      return;
    }

    /**
     * I'm not sure why Twilio is keeping the originalReservation in wrapup state
     * after a voice COLD transfer. This clause here completes this reservation.
     */
    if (isVoiceTransferWrapup(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling voice transfer wrapup...');

      const { originalTask: originalTaskSid, originalReservation } = taskAttributes.transferMeta;
      const client = context.getTwilioClient();

      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(originalTaskSid)
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
