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

export type Body = {
  request: { cookies: {}; headers: {} };
} & { taskSid: string };

// type TaskInstance = Awaited<
//   ReturnType<
//     ReturnType<
//       ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['tasks']
//     >['fetch']
//   >
// >;

type ContactType = {
  // action: string;
  taskSid: string;
  // targetSid: string;
  // finalTaskAttributes: TaskInstance['attributes'];
};

const isTaskAssigned = async (
  context: Context<EnvVars>,
  event: Required<Pick<ContactType, 'taskSid'>>,
): Promise<boolean> => {
  const client = context.getTwilioClient();

  try {
    const task = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(event.taskSid)
      .fetch();

    console.log('>>> Task fetched:', event.taskSid, task.assignmentStatus);

    const { assignmentStatus } = task;

    // if task is not assigned or task is not found, return false
    return assignmentStatus === 'assigned';
  } catch (err) {
    console.error('Error fetching task:', err);
    return false;
  }
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    console.log('event', event);

    try {
      const { taskSid } = event;

      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }

      const result = await isTaskAssigned(context, {
        taskSid,
      });

      console.log('>>> checkTaskStatus Result:', result);

      resolve(success({ isAssigned: result }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
