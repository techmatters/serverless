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
import { validator } from 'twilio-flex-token-validator';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
  error403,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
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
  Token?: string;
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
    const attributes = JSON.parse(task.attributes);
    const callSid = attributes?.call_sid;

    // Ends the task for the worker and client for chat tasks, and only for the worker for voice tasks
    const completedTask = await task.update({
      assignmentStatus: 'completed',
      attributes: event.finalTaskAttributes,
    });

    // Ends the call for the client for voice
    if (callSid) await client.calls(callSid).update({ status: 'completed' });

    return { type: 'success', completedTask } as const;
  } catch (err) {
    return {
      type: 'error',
      payload: { message: String(err) },
    };
  }
};

export type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

const isSupervisor = (tokenResult: TokenValidatorResponse) =>
  Array.isArray(tokenResult.roles) && tokenResult.roles.includes('supervisor');

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const accountSid = context.ACCOUNT_SID;
    const authToken = context.AUTH_TOKEN;
    const token = event.Token;

    if (!token) {
      resolve(error400('token'));
      return;
    }

    try {
      const tokenResult: TokenValidatorResponse = await validator(
        token as string,
        accountSid,
        authToken,
      );

      const isSupervisorToken = isSupervisor(tokenResult);

      if (!isSupervisorToken) {
        resolve(
          error403(`Unauthorized: endpoint not open to non supervisors. ${isSupervisorToken}`),
        );
        return;
      }

      const { taskSid } = event;

      if (taskSid === undefined) {
        resolve(error400('taskSid is undefined'));
        return;
      }

      const result = await closeTaskAssignment(context, {
        taskSid,
        finalTaskAttributes: JSON.stringify({}),
      });

      resolve(success(result));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
