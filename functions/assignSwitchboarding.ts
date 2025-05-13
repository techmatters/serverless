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

export type OperationType = 'enable' | 'disable' | 'status';

export type Body = {
  originalQueueSid?: string;
  operation: OperationType;
  request: { cookies: {}; headers: {} };
  Token: string;
};

export type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

type SwitchboardingState = {
  isSwitchboardingActive: boolean; // Using the frontend naming for consistency
  queueSid?: string;
  queueName?: string;
  supervisorWorkerSid?: string;
  startTime?: string;
};

const SWITCHBOARD_DOCUMENT_NAME = 'switchboard-state';
const DEFAULT_SWITCHBOARD_STATE: SwitchboardingState = {
  isSwitchboardingActive: false,
  queueSid: undefined,
  queueName: undefined,
  startTime: undefined,
  supervisorWorkerSid: undefined,
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
    isSwitchboardingActive:
      state.isSwitchboardingActive === undefined ? false : state.isSwitchboardingActive,
    queueSid: state.queueSid,
    queueName: state.queueName,
    startTime: state.startTime,
    supervisorWorkerSid: state.supervisorWorkerSid,
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
  // This improved filter will:
  // 1. Identify tasks that should go to the original queue
  // 2. Mark them with attributes needed for switchboarding
  // 3. Route them to the switchboard queue with proper attributes
  // 4. Exclude tasks that are transfers or already handled
  const switchboardingFilter = {
    filter_friendly_name: 'Switchboard Workflow',
    expression:
      'task.transferMeta == null AND task.switchboardingHandled == null AND task.switchboardingTransferExempt == null',
    targets: [
      {
        queue: switchboardQueueSid,
        expression: 'worker.available == true', // Only route to available workers
        priority: 100, // High priority
        // For tasks that would normally go to the original queue, redirect them
        target_expression: `DEFAULT_TARGET_QUEUE_SID == '${originalQueueSid}'`,
        // Add task attributes to help the Switchboard Workflow process it correctly
        task_attributes: {
          originalQueueSid,
          needsSwitchboarding: true,
          taskQueueSid: switchboardQueueSid,
        },
      },
    ],
  };

  // log the corrent filters
  console.log('>>> Current filters:', updatedConfig.task_routing.filters);

  // Insert the new filter at the beginning of the task_routing.filters array
  updatedConfig.task_routing.filters.unshift(switchboardingFilter);

  // log the updated filters
  console.log('>>> Updated filters:', updatedConfig.task_routing.filters);

  return updatedConfig;
}

/**
 * Finds all tasks in a queue that are in a specific status
 */
async function findTasksInQueue(
  client: any,
  workspaceSid: string,
  queueSid: string,
  assignmentStatus: string = 'pending',
): Promise<any[]> {
  try {
    console.log(`>>> Finding ${assignmentStatus} tasks in queue ${queueSid}`);
    // Get all tasks with the specific status in the queue
    const tasks = await client.taskrouter.workspaces(workspaceSid).tasks.list({
      assignmentStatus,
      taskQueueSid: queueSid,
    });

    console.log(`>>> Found ${tasks.length} ${assignmentStatus} tasks in queue ${queueSid}`);
    return tasks;
  } catch (err) {
    console.error(`>>> Error finding ${assignmentStatus} tasks in queue:`, err);
    throw err;
  }
}

/**
 * Moves a task from one queue to another
 */
async function moveTaskToQueue(
  client: any,
  workspaceSid: string,
  taskSid: string,
  targetQueueSid: string,
  additionalAttributes: Record<string, any> = {},
): Promise<void> {
  try {
    console.log(`>>> Moving task ${taskSid} to queue ${targetQueueSid}`);

    // First get the task to get its current attributes
    const task = await client.taskrouter.workspaces(workspaceSid).tasks(taskSid).fetch();
    const currentAttributes = JSON.parse(task.attributes);

    // Merge in any additional attributes
    const updatedAttributes = {
      ...currentAttributes,
      ...additionalAttributes,
      taskQueueSid: targetQueueSid,
    };

    // Update the task with new attributes and move it to the new queue
    await client.taskrouter
      .workspaces(workspaceSid)
      .tasks(taskSid)
      .update({
        attributes: JSON.stringify(updatedAttributes),
        taskQueueSid: targetQueueSid,
      });

    console.log(`>>> Successfully moved task ${taskSid} to queue ${targetQueueSid}`);
  } catch (err) {
    console.error('>>> Error moving task to queue:', err);
    throw err;
  }
}

/**
 * Moves waiting tasks from source queue to target queue
 */
async function moveWaitingTasks(
  client: any,
  workspaceSid: string,
  sourceQueueSid: string,
  targetQueueSid: string,
  additionalAttributes: Record<string, any> = {},
): Promise<number> {
  try {
    // Find all waiting tasks in the source queue
    const waitingTasks = await findTasksInQueue(client, workspaceSid, sourceQueueSid, 'pending');

    if (waitingTasks.length === 0) {
      console.log(`>>> No waiting tasks found in queue ${sourceQueueSid} to move`);
      return 0;
    }

    console.log(
      `>>> Moving ${waitingTasks.length} waiting tasks from ${sourceQueueSid} to ${targetQueueSid}`,
    );

    // Create an array of promises for all task moves (to process them in parallel)
    const movePromises = waitingTasks.map((task) =>
      moveTaskToQueue(client, workspaceSid, task.sid, targetQueueSid, additionalAttributes),
    );

    // Wait for all move operations to complete in parallel
    await Promise.all(movePromises);

    return waitingTasks.length;
  } catch (err) {
    console.error('>>> Error moving waiting tasks:', err);
    throw err;
  }
}

/**
 * Removes the switchboarding filter from the workflow configuration
 */
function removeSwitchboardingFilter(config: any): any {
  // Clone the configuration to avoid modifying the original
  const updatedConfig = JSON.parse(JSON.stringify(config));

  // Remove the switchboarding filter (identified by its friendly name)
  updatedConfig.task_routing.filters = updatedConfig.task_routing.filters.filter(
    (filter: any) => filter.filter_friendly_name !== 'Switchboard Workflow',
  );

  return updatedConfig;
}

/**
 * Handles the 'status' operation - returns current switchboarding state
 */
async function handleStatusOperation(
  client: any,
  syncServiceSid: string,
  resolve: (response: any) => void,
) {
  console.log('Getting current switchboarding status');
  const switchboardingState = await getSwitchboardState(client, syncServiceSid);
  console.log(`Current state - isEnabled: ${switchboardingState.isSwitchboardingActive}`);
  resolve(success(switchboardingState));
}

/**
 * Handles the 'enable' operation - turns on switchboarding for a queue
 */
async function handleEnableOperation(
  client: any,
  syncServiceSid: string,
  workspaceSid: string,
  taskRouterClient: any,
  originalQueue: any,
  switchboardQueue: any,
  masterWorkflow: any,
  tokenResult: TokenValidatorResponse,
  resolve: (response: any) => void,
) {
  console.log('Enabling switchboarding mode');
  const switchboardingState = await getSwitchboardState(client, syncServiceSid);

  // Check if already enabled for this queue
  if (
    switchboardingState.isSwitchboardingActive &&
    switchboardingState.queueSid === originalQueue.sid
  ) {
    console.log('Switchboarding is already enabled for this queue');
    resolve(
      success({
        message: 'Switchboarding is already active for this queue',
        state: switchboardingState,
      }),
    );
    return;
  }

  // Update workflow configuration
  console.log('Updating Master Workflow configuration');
  const masterConfig = JSON.parse(masterWorkflow.configuration);
  const updatedMasterConfig = addSwitchboardingFilter(
    masterConfig,
    originalQueue.sid,
    switchboardQueue.sid,
  );

  await taskRouterClient.workflows(masterWorkflow.sid).update({
    configuration: JSON.stringify(updatedMasterConfig),
  });

  // Move waiting tasks from original queue to switchboard queue
  try {
    console.log('Moving waiting tasks from original queue to switchboard queue');
    const movedCount = await moveWaitingTasks(
      client,
      workspaceSid,
      originalQueue.sid,
      switchboardQueue.sid,
      {
        originalQueueSid: originalQueue.sid,
        needsSwitchboarding: true,
      },
    );
    console.log(`Successfully moved ${movedCount} tasks to switchboard queue`);
  } catch (moveErr) {
    console.error('Failed to move waiting tasks:', moveErr);
    // Continue with enabling switchboarding even if moving tasks fails
  }

  // Update state in Sync
  console.log('Updating switchboarding state');
  const updatedState = await updateSwitchboardState(client, syncServiceSid, {
    isSwitchboardingActive: true,
    queueSid: originalQueue.sid,
    queueName: originalQueue.friendlyName,
    supervisorWorkerSid: tokenResult.worker_sid,
    startTime: new Date().toISOString(),
  });

  console.log('Switchboarding mode successfully enabled');
  resolve(
    success({
      message: 'Switchboarding mode enabled',
      state: updatedState,
    }),
  );
}

/**
 * Handles the 'disable' operation - turns off switchboarding
 */
async function handleDisableOperation(
  client: any,
  syncServiceSid: string,
  workspaceSid: string,
  taskRouterClient: any,
  switchboardQueue: any,
  masterWorkflow: any,
  resolve: (response: any) => void,
) {
  console.log('Disabling switchboarding mode');
  const switchboardingState = await getSwitchboardState(client, syncServiceSid);

  // Check if already disabled
  if (!switchboardingState.isSwitchboardingActive) {
    console.log('Switchboarding is not currently enabled');
    resolve(
      success({
        message: 'Switchboarding is not currently active',
        state: switchboardingState,
      }),
    );
    return;
  }

  // Update workflow configuration
  console.log('Updating Master Workflow configuration');
  const masterConfig = JSON.parse(masterWorkflow.configuration);
  const updatedMasterConfig = removeSwitchboardingFilter(masterConfig);

  await taskRouterClient.workflows(masterWorkflow.sid).update({
    configuration: JSON.stringify(updatedMasterConfig),
  });

  // Move waiting tasks back to original queue
  const queueToRestoreTo = switchboardingState.queueSid;
  if (queueToRestoreTo) {
    try {
      console.log('Moving waiting tasks from switchboard queue back to original queue');
      const movedCount = await moveWaitingTasks(
        client,
        workspaceSid,
        switchboardQueue.sid,
        queueToRestoreTo,
        {
          needsSwitchboarding: false,
          switchboardingHandled: true,
        },
      );
      console.log(`Successfully moved ${movedCount} tasks back to original queue`);
    } catch (moveErr) {
      console.error('Failed to move waiting tasks:', moveErr);
      // Continue with disabling switchboarding even if moving tasks fails
    }
  } else {
    console.log('No original queue SID found in state, skipping task migration');
  }

  // Update state in Sync
  console.log('Updating switchboarding state');
  const updatedState = await updateSwitchboardState(client, syncServiceSid, {
    isSwitchboardingActive: false,
    queueSid: undefined,
    queueName: undefined,
    supervisorWorkerSid: undefined,
    startTime: undefined,
  });

  console.log('Switchboarding mode successfully disabled');
  resolve(
    success({
      message: 'Switchboarding mode disabled',
      state: updatedState,
    }),
  );
}

/**
 * Main handler function
 */
export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('Starting switchboarding handler');
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { Token: token } = event;
    if (!token) {
      console.error('Token is missing in the request');
      resolve(error400('token'));
      return;
    }

    try {
      // Validate token and check for supervisor permissions
      const tokenResult: TokenValidatorResponse = await validator(
        token as string,
        context.ACCOUNT_SID,
        context.AUTH_TOKEN,
      );

      if (!isSupervisor(tokenResult)) {
        console.error('Unauthorized access attempt by non-supervisor');
        resolve(error403('Unauthorized: endpoint not open to non supervisors'));
        return;
      }

      const { originalQueueSid, operation } = event;
      console.log(`Operation: ${operation}, OriginalQueueSid: ${originalQueueSid}`);

      // Set up Twilio clients
      const client = context.getTwilioClient();
      const syncServiceSid = context.SYNC_SERVICE_SID;
      const taskRouterClient = client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID);

      // Get queues and find switchboard queue
      const queues = await taskRouterClient.taskQueues.list();
      const switchboardQueue = queues.find((queue) => queue.friendlyName === 'Switchboard Queue');

      if (!switchboardQueue) {
        console.error('Switchboard Queue not found');
        resolve(error400('Switchboard Queue not found'));
        return;
      }

      // Handle status operation
      if (operation === 'status') {
        await handleStatusOperation(client, syncServiceSid, resolve);
        return;
      }

      // For enable/disable operations, originalQueueSid is required
      if (!originalQueueSid) {
        console.error('Original Queue SID is required for enable/disable operations');
        resolve(error400('Original Queue SID is required'));
        return;
      }

      // Find original queue
      const originalQueue = queues.find((queue) => queue.sid === originalQueueSid);
      if (!originalQueue) {
        console.error('Original Queue not found');
        resolve(error400('Original Queue not found'));
        return;
      }

      // Find Master Workflow
      const workflows = await taskRouterClient.workflows.list();
      const masterWorkflow = workflows.find(
        (workflow) => workflow.friendlyName === 'Master Workflow',
      );

      if (!masterWorkflow) {
        console.error('Master Workflow not found');
        resolve(error400('Master Workflow not found'));
        return;
      }

      // Handle enable/disable operations
      if (operation === 'enable') {
        await handleEnableOperation(
          client,
          syncServiceSid,
          context.TWILIO_WORKSPACE_SID,
          taskRouterClient,
          originalQueue,
          switchboardQueue,
          masterWorkflow,
          tokenResult,
          resolve,
        );
        return;
      }
      if (operation === 'disable') {
        await handleDisableOperation(
          client,
          syncServiceSid,
          context.TWILIO_WORKSPACE_SID,
          taskRouterClient,
          switchboardQueue,
          masterWorkflow,
          resolve,
        );
        return;
      }
    } catch (err: any) {
      console.error('Error in switchboarding handler:', err);
      resolve(error500(err));
    }
    console.log('Switchboarding handler completed');
  },
);
