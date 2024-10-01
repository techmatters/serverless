// Close task as a supervisor
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
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type TaskInstance = Awaited<
  ReturnType<
    ReturnType<
      ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['tasks']
    >['fetch']
  >
>;

type ContactComplete = {
  action: 'complete';
  taskSid: string;
  targetSid: string;
  finalTaskAttributes: TaskInstance['attributes'];
};

export type Body = {
  request: { cookies: {}; headers: {} };
} & ContactComplete;

type AssignmentResult =
  | {
      type: 'error';
      payload: { message: string; attributes?: string };
    }
  | { type: 'success'; completedTask: TaskInstance };

const closeTaskAssignment = async (
  context: Context<EnvVars>,
  event: Required<Pick<ContactComplete, 'taskSid' | 'finalTaskAttributes'>>,
): Promise<AssignmentResult> => {
  const client = context.getTwilioClient();

  try {
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(event.taskSid)
      .fetch();

    await task.update({ attributes: event.finalTaskAttributes });

    const completedTask = await task.update({ assignmentStatus: 'completed' });

    console.log('>>> Task fetched:', event.taskSid, completedTask);

    return { type: 'success', completedTask } as const;
  } catch (err) {
    return {
      type: 'error',
      payload: { message: String(err) },
    };
  }
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    console.log(event);

    try {
      const { taskSid } = event;

      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }

      const result = await closeTaskAssignment(context, {
        taskSid,
        finalTaskAttributes: JSON.stringify({ status: 'closed' }),
      });

      console.log('>>> checkTaskStatus Result:', result);

      resolve(success(result));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
