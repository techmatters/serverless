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
  operation?: 'enable' | 'disable' | 'status';
  request: { cookies: {}; headers: {} };
  Token: string;
};

export type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

type SwitchboardingState = {
  isEnabled: boolean;
  originalQueueSid?: string;
  originalQueueName?: string;
  enabledBy?: string;
  enabledAt?: string;
};

const switchboardingState: SwitchboardingState = {
  isEnabled: false,
};

const isSupervisor = (tokenResult: TokenValidatorResponse) =>
  Array.isArray(tokenResult.roles) && tokenResult.roles.includes('supervisor');

/**
 * Adds a filter to the workflow configuration to redirect calls from originalQueue to switchboardQueue
 * except for calls that have been transferred (to avoid bouncing)
 */
function addSwitchboardingFilter(
  config: any,
  originalQueueSid: string,
  switchboardQueueSid: string,
): any {
  // Clone the configuration to avoid modifying the original
  const updatedConfig = JSON.parse(JSON.stringify(config));

  // Add a new filter at the top of the filter chain to redirect to switchboard
  // This filter should check if:
  // 1. The task is targeting the original queue
  // 2. The task is not a transfer (check transferMeta or other attributes)
  const switchboardingFilter = {
    filter_friendly_name: 'Switchboarding Active Filter',
    expression: `task.taskQueueSid == "${originalQueueSid}" AND !task.transferMeta`,
    targets: [
      {
        queue: switchboardQueueSid,
        expression: 'worker.available == true', // Only route to available workers
        priority: 100, // High priority
        skip_if: 'task.transferMeta', // Skip if it's a transfer
      },
    ],
  };

  // Insert the new filter at the beginning of the task_routing.filters array
  updatedConfig.task_routing.filters.unshift(switchboardingFilter);

  return updatedConfig;
}

/**
 * Removes the switchboarding filter from the workflow configuration
 */
function removeSwitchboardingFilter(config: any): any {
  // Clone the configuration to avoid modifying the original
  const updatedConfig = JSON.parse(JSON.stringify(config));

  // Remove the switchboarding filter (identified by its friendly name)
  updatedConfig.task_routing.filters = updatedConfig.task_routing.filters.filter(
    (filter: any) => filter.filter_friendly_name !== 'Switchboarding Active Filter',
  );

  return updatedConfig;
}

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const accountSid = context.ACCOUNT_SID;
    const authToken = context.AUTH_TOKEN;
    const { Token: token } = event;

    if (!token) {
      console.error('Token is missing in the request.');
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
      console.log(`Is Supervisor Token: ${isSupervisorToken}`);

      if (!isSupervisorToken) {
        console.error('Unauthorized access attempt by non-supervisor.');
        resolve(
          error403(`Unauthorized: endpoint not open to non supervisors. ${isSupervisorToken}`),
        );
        return;
      }

      const { originalQueueSid, operation = 'status' } = event;

      const taskRouterClient = context
        .getTwilioClient()
        .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID);

      const queues = await taskRouterClient.taskQueues.list();

      const switchboardQueue = queues.find((queue) => queue.friendlyName === 'Switchboard Queue');
      if (!switchboardQueue) {
        console.error('Switchboard Queue not found.');
        resolve(error400('Switchboard Queue not found'));
        return;
      }

      if (operation === 'status') {
        console.log('Returning switchboarding status');
        resolve(success(switchboardingState));
        return;
      }

      if (!originalQueueSid) {
        console.error('Original Queue SID is required for enable/disable operations.');
        resolve(error400('Original Queue SID is required'));
        return;
      }

      const originalQueue = queues.find((queue) => queue.sid === originalQueueSid);
      if (!originalQueue) {
        console.error('Original Queue not found.');
        resolve(error400('Original Queue not found'));
        return;
      }
      console.log(
        `>>> Switchboard Queue: ${switchboardQueue.friendlyName}, SID: ${switchboardQueue.sid}`,
      );
      console.log(`>>> Original Queue: ${originalQueue.friendlyName}, SID: ${originalQueue.sid}`);

      const workflows = await taskRouterClient.workflows.list();

      const masterWorkflow = workflows.find(
        (workflow) => workflow.friendlyName === 'Master Workflow',
      );

      if (!masterWorkflow) {
        console.error('Master Workflow not found');
        resolve(error400('Master Workflow not found'));
        return;
      }
      console.log(
        `>>> Master Workflow: ${masterWorkflow.friendlyName}, SID: ${masterWorkflow.sid}`,
      );

      if (operation === 'enable') {
        console.log('Enabling switchboarding mode...');
        if (
          switchboardingState.isEnabled &&
          switchboardingState.originalQueueSid === originalQueueSid
        ) {
          console.log('Switchboarding is already enabled for this queue.');
          resolve(
            success({
              message: 'Switchboarding is already active for this queue',
              state: switchboardingState,
            }),
          );
          return;
        }

        const masterConfig = JSON.parse(masterWorkflow.configuration);

        const updatedMasterConfig = addSwitchboardingFilter(
          masterConfig,
          originalQueue.sid,
          switchboardQueue.sid,
        );

        await taskRouterClient.workflows(masterWorkflow.sid).update({
          configuration: JSON.stringify(updatedMasterConfig),
        });

        console.log('Switchboarding mode enabled');
        resolve(
          success({
            message: 'Switchboarding mode enabled',
            state: {
              isEnabled: true,
              originalQueueSid,
              originalQueueName: originalQueue.friendlyName,
              enabledBy: tokenResult.worker_sid,
              enabledAt: new Date().toISOString(),
            },
          }),
        );
      } else if (operation === 'disable') {
        console.log('Disabling switchboarding mode...');
        if (!switchboardingState.isEnabled) {
          console.log('Switchboarding is not currently enabled.');
          resolve(
            success({
              message: 'Switchboarding is not currently active',
              state: switchboardingState,
            }),
          );
          return;
        }

        const masterConfig = JSON.parse(masterWorkflow.configuration);
        const updatedMasterConfig = removeSwitchboardingFilter(masterConfig);

        await taskRouterClient.workflows(masterWorkflow.sid).update({
          configuration: JSON.stringify(updatedMasterConfig),
        });

        console.log('Switchboarding mode disabled');
        resolve(
          success({
            message: 'Switchboarding mode disabled',
            state: {
              isEnabled: false,
              originalQueueSid: undefined,
              originalQueueName: undefined,
              enabledBy: undefined,
              enabledAt: undefined,
            },
          }),
        );
      }
    } catch (err: any) {
      console.error('Error in handler:', err);
      resolve(error500(err));
    }
  },
);
