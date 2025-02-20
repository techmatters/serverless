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

/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  send,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';
import type { AdjustChatCapacityType } from './adjustChatCapacity';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
  TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID: string;
  CHAT_SERVICE_SID: string;
};

export type Body = {
  taskSid?: string;
  targetSid?: string;
  ignoreAgent?: string;
  mode?: string;
  request: { cookies: {}; headers: {} };
};

// Only used for direct transfers of conversations, not programmable chat channels
const DIRECT_TRANSFER_QUEUE_FRIENDLY_NAME = 'Everyone';

async function setDummyChannelToTask(
  context: Context<EnvVars>,
  sid: string,
  taskToCloseAttributes: any,
) {
  // set the channelSid and ProxySessionSID to a dummy value. This keeps the session alive
  const attributesWithDummyChannel = {
    ...taskToCloseAttributes,
    channelSid: 'CH00000000000000000000000000000000',
    proxySessionSID: 'KC00000000000000000000000000000000',
  };

  const client = context.getTwilioClient();

  const updatedTask = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(sid)
    .update({ attributes: JSON.stringify(attributesWithDummyChannel) });

  return updatedTask;
}

async function setDummyChannel(
  context: Context<EnvVars>,
  body: Required<Pick<Body, 'taskSid' | 'targetSid' | 'ignoreAgent' | 'mode'>>,
) {
  if (body.mode !== 'COLD') return null;

  const client = context.getTwilioClient();

  // retrieve attributes of the task to close
  const taskToClose = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.taskSid)
    .fetch();

  const taskToCloseAttributes = JSON.parse(taskToClose.attributes);

  const taskWithDummyChannel = await setDummyChannelToTask(
    context,
    body.taskSid,
    taskToCloseAttributes,
  );
  return taskWithDummyChannel;
}

// if transfer targets a worker, validates that it can be effectively transferred, and if the worker's chat capacity needs to increase
async function validateChannelIfWorker(
  context: Context<EnvVars>,
  targetSid: string,
  transferTargetType: string,
  taskChannelUniqueName: string,
  channelType: string,
) {
  if (transferTargetType === 'queue') return { type: 'queue' } as const;

  const client = context.getTwilioClient();

  const [worker, workerChannel] = await Promise.all([
    client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).workers(targetSid).fetch(),
    client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .workers(targetSid)
      .workerChannels(taskChannelUniqueName)
      .fetch(),
  ]);

  if (!worker.available) {
    return {
      type: 'error',
      payload: { status: 403, message: "Error: can't transfer to an offline counselor" },
    } as const;
  }

  const workerAttr = JSON.parse(worker.attributes);

  const unavailableVoice = channelType === 'voice' && !workerChannel.availableCapacityPercentage;
  // if maxMessageCapacity is not set, just use configuredCapacity without adjustChatCapacity
  const unavailableChat = workerAttr.maxMessageCapacity
    ? channelType !== 'voice' &&
      !workerChannel.availableCapacityPercentage &&
      workerChannel.configuredCapacity >= workerAttr.maxMessageCapacity
    : channelType !== 'voice' && !workerChannel.availableCapacityPercentage;

  if (unavailableVoice || unavailableChat) {
    return {
      type: 'error',
      payload: { status: 403, message: 'Error: counselor has no available capacity' },
    } as const;
  }

  const shouldIncrease =
    workerAttr.maxMessageCapacity &&
    channelType !== 'voice' &&
    !workerChannel.availableCapacityPercentage &&
    workerChannel.configuredCapacity < workerAttr.maxMessageCapacity;

  return { type: 'worker', worker, shouldIncrease } as const;
}

async function increaseChatCapacity(
  context: Context<EnvVars>,
  validationResult: Awaited<ReturnType<typeof validateChannelIfWorker>>,
) {
  // once created the task, increase worker chat capacity if needed
  if (validationResult.shouldIncrease) {
    const { path } = Runtime.getFunctions().adjustChatCapacity;
    // eslint-disable-next-line prefer-destructuring
    const adjustChatCapacity: AdjustChatCapacityType = require(path).adjustChatCapacity;

    const { worker } = validationResult;

    const body = {
      workerSid: worker?.sid as string,
      adjustment: 'increaseUntilCapacityAvailable',
    } as const;

    await adjustChatCapacity(context, body);
  }
}

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.info('===== transferChatStart invocation =====');
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { taskSid, targetSid, ignoreAgent, mode } = event;

    try {
      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (ignoreAgent === undefined) {
        resolve(error400('ignoreAgent'));
        return;
      }
      if (mode === undefined) {
        resolve(error400('mode'));
        return;
      }

      // retrieve attributes of the original task
      const originalTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();
      console.debug('Original task fetched', originalTask);
      const originalAttributes = JSON.parse(originalTask.attributes);

      const transferTargetType = targetSid.startsWith('WK') ? 'worker' : 'queue';

      const validationResult = await validateChannelIfWorker(
        context,
        targetSid,
        transferTargetType,
        originalTask.taskChannelUniqueName,
        originalAttributes.channelType,
      );

      if (validationResult.type === 'error') {
        const { status, message } = validationResult.payload;
        resolve(send(status)({ status, message }));
        return;
      }

      /**
       * Conversations comes with attributes.conversations filled in.
       * The code below can be simplified after all channels are moved to conversations.
       */
      const originalConversations = originalAttributes.conversations;
      let conversations;

      if (originalConversations) {
        conversations = originalConversations;
      } else if (originalAttributes.conversation) {
        conversations = originalAttributes.conversation;
      } else {
        conversations = { conversation_id: taskSid };
      }

      const newAttributes = {
        ...originalAttributes,
        conversations, // set up attributes of the new task to link them to the original task in Flex Insights
        ignoreAgent, // update task attributes to ignore the agent who transferred the task
        targetSid, // update task attributes to include the required targetSid on the task (workerSid or a queueSid)
        transferTargetType,
      };

      /**
       * Check if is transfering a conversation.
       * It might be better to accept an `isConversation` parameter.
       * But for now, we can check if a conversation exists given a conversationId.
       */

      const { flexInteractionSid, flexInteractionChannelSid } = originalAttributes;

      let isConversation = Boolean(flexInteractionSid && flexInteractionChannelSid);
      if (flexInteractionSid) {
        try {
          const interactionChannelParticipants = await client.flexApi.v1.interaction
            .get(flexInteractionSid)
            .channels.get(flexInteractionChannelSid)
            .participants.list();

          newAttributes.originalParticipantSid = interactionChannelParticipants.find(
            (p) => p.type === 'agent',
          )?.sid;
        } catch (err) {
          isConversation = false;
        }
      }

      let newTaskSid;
      if (isConversation && transferTargetType === 'worker') {
        console.debug(
          `Transferring conversations task ${taskSid} to worker ${targetSid} - looking up queues.`,
        );
        // Get task queue
        const taskQueues = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .taskQueues.list({ workerSid: targetSid });

        const taskQueueSid =
          taskQueues.find((tq) => tq.friendlyName === DIRECT_TRANSFER_QUEUE_FRIENDLY_NAME)?.sid ||
          taskQueues[0].sid;

        console.info(
          `Transferring conversations task ${taskSid} to worker ${targetSid} via queue ${taskQueueSid} and workflow ${context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID} by creating interaction invite.`,
        );
        // Create invite to target worker
        const invite = await client.flexApi.v1.interaction
          .get(flexInteractionSid)
          .channels.get(flexInteractionChannelSid)
          .invites.create({
            routing: {
              properties: {
                queue_sid: taskQueueSid,
                worker_sid: targetSid,
                workflow_sid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
                workspace_sid: context.TWILIO_WORKSPACE_SID,
                attributes: newAttributes,
                task_channel_unique_name: originalTask.taskChannelUniqueName,
              },
            },
          });

        newTaskSid = invite.routing.properties.sid;
        console.info(
          `Transferred conversations task ${taskSid} to worker ${targetSid} by creating interaction invite.`,
        );
      } else if (isConversation && transferTargetType === 'queue') {
        console.info(
          `Transferring conversations task ${taskSid} to queue ${targetSid} by creating interaction invite.`,
        );
        Object.entries({
          flexInteractionSid,
          flexInteractionChannelSid,
          TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID:
            context.TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID,
          TWILIO_WORKSPACE_SID: context.TWILIO_WORKSPACE_SID,
          newAttributes,
          taskChannelUniqueName: originalTask.taskChannelUniqueName,
        }).forEach(([key, value]) => {
          console.debug(`${key}:`, value);
        });
        console.debug('newAttributes:');
        Object.entries(newAttributes).forEach(([key, value]) => {
          console.debug(`${key}:`, value);
        });
        const invite = await client.flexApi.v1.interaction
          .get(flexInteractionSid)
          .channels.get(flexInteractionChannelSid)
          .invites.create({
            routing: {
              properties: {
                workflow_sid: context.TWILIO_CONVERSATIONS_CHAT_TRANSFER_WORKFLOW_SID,
                workspace_sid: context.TWILIO_WORKSPACE_SID,
                attributes: newAttributes,
                task_channel_unique_name: originalTask.taskChannelUniqueName,
              },
            },
          });

        console.info(
          `Transferred conversations task ${taskSid} to queue ${targetSid} by creating interaction invite.`,
        );
        newTaskSid = invite.routing.properties.sid;
      } else {
        // Edit channel attributes so that original task won't cause issues with the transferred one
        await setDummyChannel(context, {
          mode,
          ignoreAgent,
          targetSid,
          taskSid,
        });

        // create New task
        const newTask = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks.create({
            workflowSid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
            taskChannel: originalTask.taskChannelUniqueName,
            attributes: JSON.stringify(newAttributes),
            priority: 100,
          });

        newTaskSid = newTask.sid;

        // Increse the chat capacity for the target worker (if needed)
        await increaseChatCapacity(context, validationResult);
      }

      resolve(success({ taskSid: newTaskSid }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
