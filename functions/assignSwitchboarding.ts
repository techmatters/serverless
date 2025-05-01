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

export type Body = {
  originalQueueSid?: string;
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

      const { originalQueueSid } = event;

      // Initialize Twilio TaskRouter client
      const taskRouterClient = context
        .getTwilioClient()
        .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID);

      // Get list of queues and workflows
      const queues = await taskRouterClient.taskQueues.list();

      const switchboardQueue = queues.find((queue) => queue.friendlyName === 'Switchboard Queue');
      if (!switchboardQueue) {
        console.error('Switchboard Queue not found.');
        resolve(error400('Switchboard Queue not found'));
        return;
      }
      const originalQueue = queues.find((queue) => queue.sid === originalQueueSid);
      if (!originalQueue) {
        console.error('Original Queue not found.');
        resolve(error400('Original Queue not found'));
        return;
      }
      console.log(`>>> Original Queue: ${originalQueue.friendlyName}, SID: ${originalQueue.sid}`);

      const workflows = await taskRouterClient.workflows.list();

      // Log each workflow individually with key properties
      console.log('>>> Workflows Information:');
      workflows.forEach((workflow, index) => {
        console.log(`\n>>> Workflow ${index + 1}:`);
        console.log(`>>> Friendly Name: ${workflow.friendlyName}`);
        console.log(`>>> Assignment Callback URL: ${workflow.assignmentCallbackUrl || 'N/A'}`);
        console.log(`>>> Task Reservation Timeout: ${workflow.taskReservationTimeout}`);
        try {
          // Parse configuration to log it in a readable way
          const config = JSON.parse(workflow.configuration);
          console.log(
            `>>> Configuration Summary: ${JSON.stringify(config, null, 2).substring(0, 500)}...`,
          );
        } catch (e) {
          console.log(`>>> Configuration (raw): ${workflow.configuration}`);
        }
      });

      // Check for Master Workflow
      const masterWorkflow = workflows.find(
        (workflow) => workflow.friendlyName === 'Master Workflow',
      );
      // if (!masterWorkflow) {
      //   console.error('Master Workflow not found');
      //   resolve(error400('Master Workflow not found parameter not provided'));
      //   return;
      // }

      // // Check for Transfer Workflow
      const transferWorkflow = workflows.find((workflow) => workflow.friendlyName === 'Transfers');
      // if (!transferWorkflow) {
      //   console.error('Transfers Workflow not found');
      //   resolve(error400('Transfers Workflow not found parameter not provided'));
      //   return;
      // }

      // Both workflows found, proceed
      const masterConfiguration = JSON.stringify(masterWorkflow?.configuration, null, 2);
      const transferConfiguration = JSON.stringify(transferWorkflow?.configuration, null, 2);

      console.log(`>>> Master Workflow Configuration: ${masterConfiguration}`);
      console.log(`>>> Transfer Workflow Configuration: ${transferConfiguration}`);

      const result = 'Switchboarding mode enabled';
      resolve(success(result));
    } catch (err: any) {
      console.error('Error in handler:', err);
      resolve(error500(err));
    }
  },
);
