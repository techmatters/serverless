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
  SYNC_SERVICE_SID: string;
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

// Sync document constants
const SWITCHBOARD_DOCUMENT_NAME = 'switchboard-state';
const DEFAULT_SWITCHBOARD_STATE: SwitchboardingState = {
  isEnabled: false,
};

/**
 * Get or create the switchboard document in Twilio Sync
 */
async function getSwitchboardStateDocument(client: any, syncServiceSid: string): Promise<any> {
  try {
    return client.sync.services(syncServiceSid).documents(SWITCHBOARD_DOCUMENT_NAME).fetch();
  } catch (error: any) {
    // If document doesn't exist, create it
    if (error.status === 404) {
      return client.sync.services(syncServiceSid).documents.create({
        uniqueName: SWITCHBOARD_DOCUMENT_NAME,
        data: DEFAULT_SWITCHBOARD_STATE,
        ttl: 48 * 60 * 60, // 48 hours
      });
    }
    throw error;
  }
}

/**
 * Get current switchboarding state
 */
async function getSwitchboardState(
  client: any,
  syncServiceSid: string,
): Promise<SwitchboardingState> {
  const document = await getSwitchboardStateDocument(client, syncServiceSid);

  const state = document.data || {};

  return {
    isEnabled: state.isEnabled === undefined ? false : state.isEnabled,
    originalQueueSid: state.originalQueueSid,
    originalQueueName: state.originalQueueName,
    enabledBy: state.enabledBy,
    enabledAt: state.enabledAt,
  };
}

/**
 * Update switchboarding state
 */
async function updateSwitchboardState(
  client: any,
  syncServiceSid: string,
  state: Partial<SwitchboardingState>,
): Promise<SwitchboardingState> {
  const document = await getSwitchboardStateDocument(client, syncServiceSid);
  const currentState = document.data;
  const updatedState = { ...currentState, ...state };

  await client.sync.services(syncServiceSid).documents(SWITCHBOARD_DOCUMENT_NAME).update({
    data: updatedState,
  });

  return updatedState;
}

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
    console.log('>>> 1. FUNCTION ENTRY: Starting switchboarding handler');
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const accountSid = context.ACCOUNT_SID;
    const authToken = context.AUTH_TOKEN;
    const { Token: token } = event;

    if (!token) {
      console.error('>>> 1b ERROR: Token is missing in the request');
      resolve(error400('token'));
      return;
    }

    try {
      console.log('>>> 1a: Validating token');
      const tokenResult: TokenValidatorResponse = await validator(
        token as string,
        accountSid,
        authToken,
      );

      const isSupervisorToken = isSupervisor(tokenResult);
      console.log(`>>> 1a: Is Supervisor Token: ${isSupervisorToken}`);

      if (!isSupervisorToken) {
        console.error('>>> 1c ERROR: Unauthorized access attempt by non-supervisor');
        resolve(
          error403(`Unauthorized: endpoint not open to non supervisors. ${isSupervisorToken}`),
        );
        return;
      }

      const { originalQueueSid, operation = 'status' } = event;
      console.log(`>>> 2. EVENT: ${JSON.stringify(event)}`);

      const client = context.getTwilioClient();
      const syncServiceSid = context.SYNC_SERVICE_SID;
      console.log(
        `>>> 2a. STATE MANAGEMENT: Setting up Twilio clients with SyncServiceSid: ${syncServiceSid}`,
      );
      const taskRouterClient = client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID);

      console.log('>>> 3. Fetching TaskRouter queues');
      const queues = await taskRouterClient.taskQueues.list();

      const switchboardQueue = queues.find((queue) => queue.friendlyName === 'Switchboard Queue');
      if (!switchboardQueue) {
        console.error('>>> 3b. QUEUES ERROR: Switchboard Queue not found');
        resolve(error400('Switchboard Queue not found'));
        return;
      }
      console.log(`>>> 3a. Found Switchboard Queue with SID: ${switchboardQueue.sid}`);

      if (operation === 'status') {
        console.log('>>> 4. STATUS: Retrieving current switchboarding status');
        const switchboardingState = await getSwitchboardState(client, syncServiceSid);
        console.log(
          `>>> 4a. STATUS: Current state - isEnabled: ${
            switchboardingState.isEnabled === undefined ? false : switchboardingState.isEnabled
          }`,
        );
        console.log('>>> 4b. STATUS: Full switchboard state:', JSON.stringify(switchboardingState));
        resolve(success(switchboardingState));
        return;
      }

      if (!originalQueueSid) {
        console.error('>>> 5b ERROR: Original Queue SID is required for enable/disable operations');
        resolve(error400('Original Queue SID is required'));
        return;
      }

      const originalQueue = queues.find((queue) => queue.sid === originalQueueSid);
      if (!originalQueue) {
        console.error('>>> 5c ERROR: Original Queue not found');
        resolve(error400('Original Queue not found'));
        return;
      }
      console.log(
        `>>> 5a. Switchboard Queue: ${switchboardQueue.friendlyName}, SID: ${switchboardQueue.sid}`,
      );
      console.log(
        `>>> 5a. Original Queue: ${originalQueue.friendlyName}, SID: ${originalQueue.sid}`,
      );

      console.log('>>> 6. WORKFLOWS: Fetching TaskRouter workflows');
      const workflows = await taskRouterClient.workflows.list();

      const masterWorkflow = workflows.find(
        (workflow) => workflow.friendlyName === 'Master Workflow',
      );

      if (!masterWorkflow) {
        console.error('>>> 6b. WORKFLOWS ERROR: Master Workflow not found');
        resolve(error400('Master Workflow not found'));
        return;
      }
      console.log(`>>> 6a. WORKFLOWS: Found Master Workflow with SID: ${masterWorkflow.sid}`);

      if (operation === 'enable') {
        console.log('>>> 7. ENABLE: Enabling switchboarding mode');
        const switchboardingState = await getSwitchboardState(client, syncServiceSid);
        if (
          switchboardingState.isEnabled &&
          switchboardingState.originalQueueSid === originalQueueSid
        ) {
          console.log('>>> 7b. ENABLE: Switchboarding is already enabled for this queue');
          resolve(
            success({
              message: 'Switchboarding is already active for this queue',
              state: switchboardingState,
            }),
          );
          return;
        }
        console.log('>>> 7a. ENABLE: Proceeding with switchboarding activation');

        console.log('>>> 8. CONFIG UPDATE: Parsing and updating Master Workflow configuration');
        const masterConfig = JSON.parse(masterWorkflow.configuration);

        console.log('>>> 8a. CONFIG UPDATE: Adding switchboarding filter to workflow');
        const updatedMasterConfig = addSwitchboardingFilter(
          masterConfig,
          originalQueue.sid,
          switchboardQueue.sid,
        );

        console.log('>>> 8a. CONFIG UPDATE: Applying updated configuration to Master Workflow');
        await taskRouterClient.workflows(masterWorkflow.sid).update({
          configuration: JSON.stringify(updatedMasterConfig),
        });

        console.log('>>> 9. STATE UPDATE: Updating switchboarding state in Sync');
        const updatedState = await updateSwitchboardState(client, syncServiceSid, {
          isEnabled: true,
          originalQueueSid,
          originalQueueName: originalQueue.friendlyName,
          enabledBy: tokenResult.worker_sid,
          enabledAt: new Date().toISOString(),
        });

        console.log('>>> 9a. STATE UPDATE: Switchboarding mode successfully enabled');
        resolve(
          success({
            message: 'Switchboarding mode enabled',
            state: updatedState,
          }),
        );
      } else if (operation === 'disable') {
        console.log('>>> 7. DISABLE: Disabling switchboarding mode');
        const switchboardingState = await getSwitchboardState(client, syncServiceSid);
        if (!switchboardingState.isEnabled) {
          console.log('>>> 7c. DISABLE: Switchboarding is not currently enabled');
          resolve(
            success({
              message: 'Switchboarding is not currently active',
              state: switchboardingState,
            }),
          );
          return;
        }
        console.log('>>> 7a. DISABLE: Proceeding with switchboarding deactivation');

        console.log('>>> 8. CONFIG UPDATE: Parsing and updating Master Workflow configuration');
        const masterConfig = JSON.parse(masterWorkflow.configuration);
        console.log('>>> 8a. CONFIG UPDATE: Removing switchboarding filter from workflow');
        const updatedMasterConfig = removeSwitchboardingFilter(masterConfig);

        console.log('>>> 8a. CONFIG UPDATE: Applying updated configuration to Master Workflow');
        await taskRouterClient.workflows(masterWorkflow.sid).update({
          configuration: JSON.stringify(updatedMasterConfig),
        });

        console.log('>>> 9. STATE UPDATE: Updating switchboarding state in Sync');
        const updatedState = await updateSwitchboardState(client, syncServiceSid, {
          isEnabled: false,
          originalQueueSid: undefined,
          originalQueueName: undefined,
          enabledBy: undefined,
          enabledAt: undefined,
        });

        console.log('>>> 9a. STATE UPDATE: Switchboarding mode successfully disabled');
        resolve(
          success({
            message: 'Switchboarding mode disabled',
            state: updatedState,
          }),
        );
      }
    } catch (err: any) {
      console.error('>>> Error in switchboarding handler:', err);
      resolve(error500(err));
    }
    console.log('>>> Switchboarding handler completed');
  },
);
