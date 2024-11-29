// Get task as a supervisor
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
  send,
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

export type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

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

      const isSupervisorToken =
        Array.isArray(tokenResult.roles) && tokenResult.roles.includes('supervisor');

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
      try {
        const result = await context
          .getTwilioClient()
          .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(event.taskSid)
          .fetch();
        resolve(success(result));
      } catch (err) {
        const error = err as Error;
        if (
          error.message.match(
            /The requested resource \/Workspaces\/WS[a-z0-9]+\/Tasks\/WT[a-z0-9]+ was not found/,
          )
        ) {
          resolve(send(404)({ message: error.message }));
          return;
        }
        resolve(error500(error));
      }
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
