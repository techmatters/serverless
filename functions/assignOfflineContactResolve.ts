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
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  send,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

// ================ //
// TODO: share this code with Flex
type OfflineContactComplete = {
  action: 'complete';
  taskSid: string;
  targetSid: string;
  finalTaskAttributes: TaskInstance['attributes'];
};

type OfflineContactRemove = {
  action: 'remove';
  taskSid: string;
};
// ================ //

type OfflineContactResolvePayload = OfflineContactComplete | OfflineContactRemove;

export type Body = {
  request: { cookies: {}; headers: {} };
} & OfflineContactResolvePayload;

type TaskInstance = Awaited<
  ReturnType<
    ReturnType<
      ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['tasks']
    >['fetch']
  >
>;
type AssignmentResult =
  | {
      type: 'error';
      payload: { message: string; attributes?: string };
    }
  | { type: 'success'; completedTask: TaskInstance };

const updateAndCompleteTask = async (
  context: Context<EnvVars>,
  event: Required<Pick<OfflineContactComplete, 'taskSid' | 'finalTaskAttributes'>>,
): Promise<AssignmentResult> => {
  const client = context.getTwilioClient();

  try {
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(event.taskSid)
      .fetch();

    await task.update({ attributes: event.finalTaskAttributes });

    const completedTask = await task.update({ assignmentStatus: 'completed' });

    return { type: 'success', completedTask } as const;
  } catch (err) {
    return {
      type: 'error',
      payload: { message: String(err), attributes: event.finalTaskAttributes },
    };
  }
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { action, taskSid } = event;

      if (action === undefined || (action !== 'complete' && action !== 'remove')) {
        resolve(error400('action'));
        return;
      }

      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }

      // If action is "complete", we want to update the task attributes to it's final form and complete it
      if (action === 'complete') {
        const { taskSid, finalTaskAttributes } = event;

        if (finalTaskAttributes === undefined) {
          resolve(error400('finalTaskAttributes'));
          return;
        }

        const result = await updateAndCompleteTask(context, {
          taskSid,
          finalTaskAttributes,
        });

        if (result.type === 'error') {
          const { payload } = result;
          resolve(send(500)(payload));
          return;
        }

        resolve(success(result.completedTask));
        return;
      }

      // If action is "remove", we want to cleanup the stuck task
      if (action === 'remove') {
        const removed = await context
          .getTwilioClient()
          .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(event.taskSid)
          .remove();

        resolve(success({ removed, taskSid }));
        return;
      }

      resolve(error400('Invalid operation'));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
