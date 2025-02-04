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

const getReservations = async (context: Context<EnvVars>, taskSid: string) => {
  try {
    const reservations = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(taskSid)
      .reservations.list();

    if (reservations.length === 0) {
      console.info(`No reservations found for task ${taskSid}`);
    }

    return reservations;
  } catch (err) {
    console.error('Failed to fetch reservations:', err);
    return undefined;
  }
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { ACCOUNT_SID: accountSid, AUTH_TOKEN: authToken } = context;
    const { Token: token, taskSid } = event;

    if (!token) {
      return resolve(error400('token'));
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
        return resolve(error403('Unauthorized: endpoint not open to non supervisors.'));
      }

      if (taskSid === undefined) {
        return resolve(error400('taskSid is undefined'));
      }

      const reservations = await getReservations(context, taskSid);

      try {
        const task = await context
          .getTwilioClient()
          .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(taskSid)
          .fetch();

        return resolve(success({ task, reservations }));
      } catch (err: any) {
        const error = err as Error;
        if (
          error.message.match(
            /The requested resource \/Workspaces\/WS[a-z0-9]+\/Tasks\/WT[a-z0-9]+ was not found/,
          )
        ) {
          return resolve(send(404)({ message: error.message, status: 404 }));
        }
        return resolve(error500(error));
      }
    } catch (err) {
      return resolve(error500(err as Error));
    }
  },
);
