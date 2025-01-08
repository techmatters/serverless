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
  TWILIO_WORKFLOW_SID: string;
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
};

export type Body = {
  taskSid?: string;
  originalQueueSid?: string;
  targetSid?: string;
  request: { cookies: {}; headers: {} };
  Token: string;
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
    const { Token: token } = event;

    // Check for token presence
    if (!token) {
      console.error('Token is missing in the request.');
      resolve(error400('token'));
      return;
    }

    try {
      // Validate the token
      const tokenResult: TokenValidatorResponse = await validator(
        token as string,
        accountSid,
        authToken,
      );

      // Check if the user has supervisor role
      const isSupervisorToken = isSupervisor(tokenResult);
      console.log(`Is Supervisor Token: ${isSupervisorToken}`);

      if (!isSupervisorToken) {
        console.error('Unauthorized access attempt by non-supervisor.');
        resolve(
          error403(`Unauthorized: endpoint not open to non supervisors. ${isSupervisorToken}`),
        );
        return;
      }

      const { taskSid, originalQueueSid } = event;

      // Ensure taskSid is provided
      if (taskSid === undefined) {
        console.error('taskSid is undefined.');
        resolve(error400('taskSid is undefined'));
        return;
      }

      // Initialize Twilio TaskRouter client
      const taskRouterClient = context
        .getTwilioClient()
        .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID);

      // Get list of queues and workflows
      const queues = await taskRouterClient.taskQueues.list();
      const workflows = await taskRouterClient.workflows.list();

      console.log('>>> Queues:', queues);
      console.log('>>> Workflows:', workflows);

      // Find the Switchboard Queue
      const switchboardQueue = queues.find((queue) => queue.friendlyName === 'Switchboard Queue');

      if (!switchboardQueue) {
        console.error('Switchboard Queue not found.');
        resolve(error400('Switchboard Queue not found'));
        return;
      }

      console.log(
        `>>> Switchboard Queue Found: ${switchboardQueue.friendlyName}, SID: ${switchboardQueue.sid}`,
      );

      // Update the workflow to redirect tasks to the Switchboarding queue
      await taskRouterClient
        .workflows(context.TWILIO_WORKFLOW_SID)
        .update({
          configuration: JSON.stringify({
            task_routing: {
              filters: [
                {
                  filter_friendly_name: 'Switchboarding',
                  expression: '1==1', // This will match all tasks
                  targets: [
                    {
                      queue: switchboardQueue.sid,
                      priority: 3,
                      timeout: 1200, // Timeout for task reservation
                    },
                  ],
                },
              ],
              default_filter: {
                queue: originalQueueSid, // Return to original queue if not matched
              },
            },
          }),
        })
        .then((workflow) => console.log(`Workflow Updated Successfully: ${workflow.friendlyName}`))
        .catch((error) => {
          console.error('Error updating workflow:', error);
          resolve(error500(error));
        });

      const result = 'Switchboarding mode enabled';
      resolve(success(result));
    } catch (err: any) {
      console.error('Error in handler:', err);
      resolve(error500(err));
    }
  },
);
