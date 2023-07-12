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

/**
 * This file is intended to be used as the Task Router Event Callback (see https://www.twilio.com/docs/taskrouter/api/event#event-callbacks).
 * We'll perform different actions based on the event type on each invocation.
 */

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, success, error500 } from '@tech-matters/serverless-helpers';
import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_QUEUE_ENTERED,
} from '@tech-matters/serverless-helpers/taskrouter';

const LISTENERS_FOLDER = 'taskrouterListeners/';

export const eventTypes: EventType[] = [TASK_QUEUE_ENTERED];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

export type TransferMeta = {
  mode: 'COLD' | 'WARM';
  transferStatus: 'transferring' | 'accepted' | 'rejected';
  sidWithTaskControl: string;
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

export const isChatTransferToQueueComplete = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: ChatTransferTaskAttributes,
) =>
  eventType === TASK_QUEUE_ENTERED &&
  isChatTransfer(taskChannelUniqueName, taskAttributes) &&
  taskAttributes.transferTargetType === 'queue';

/**
 * Fetch all taskrouter listeners from the listeners folder
 */
const getListeners = () => {
  const functionsMap = Runtime.getFunctions();
  const keys = Object.keys(functionsMap).filter((name) => name.includes(LISTENERS_FOLDER));
  const paths = keys.map((key) => functionsMap[key].path);
  return paths.map((path) => require(path) as TaskrouterListener);
};

const runTaskrouterListeners = async (
  context: Context<EnvVars>,
  event: EventFields,
  callback: ServerlessCallback,
) => {
  const listeners = getListeners();

  await Promise.all(
    listeners
      .filter((listener) => listener.shouldHandle(event))
      .map((listener) => listener.handleEvent(context, event, callback)),
  );
};

export const handler = async (
  context: Context<EnvVars>,
  event: EventFields,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    console.log(`===== Executing TaskrouterCallback for event: ${event.EventType} =====`);

    const {
      EventType: eventType,
      TaskChannelUniqueName: taskChannelUniqueName,
      TaskAttributes: taskAttributesString,
    } = event;

    const taskAttributes = JSON.parse(taskAttributesString);

    const { originalTask: originalTaskSid } = taskAttributes.transferMeta;
    const client = context.getTwilioClient();

    await runTaskrouterListeners(context, event, callback);

    if (isChatTransferToQueueComplete(eventType, taskChannelUniqueName, taskAttributes)) {
      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(originalTaskSid)
        .update({
          assignmentStatus: 'pending',
          reason: 'task transferred into queue',
        });
    }

    resolve(success(JSON.stringify({ eventType })));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
