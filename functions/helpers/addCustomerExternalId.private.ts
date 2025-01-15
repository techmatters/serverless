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

// eslint-disable-next-line prettier/prettier
import type { Context } from '@twilio-labs/serverless-runtime-types/types';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';

export type Body = {
  EventType: string;
  TaskSid?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type Response = {
  message: string;
  updatedTask?: TaskInstance;
};

const logAndReturnError = (
  taskSid: TaskInstance['sid'],
  workspaceSid: EnvVars['TWILIO_WORKSPACE_SID'],
  step: 'fetch' | 'update',
  errorInstance: unknown,
) => {
  const errorMessage = `Error at addCustomerExternalId: task with sid ${taskSid} does not exists in workspace ${workspaceSid} when trying to ${step} it.`;
  console.info(errorMessage, errorInstance);
  return { message: errorMessage };
};

export const addCustomerExternalId = async (
  context: Context<EnvVars>,
  event: Body,
): Promise<Response> => {
  console.log('-------- addCustomerExternalId execution --------');

  const { TaskSid } = event;
  if (!event.TaskSid) throw new Error('TaskSid missing in event object');

  let task: TaskInstance;

  try {
    task = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(event.TaskSid)
      .fetch();
  } catch (err) {
    return logAndReturnError(event.TaskSid, context.TWILIO_WORKSPACE_SID, 'fetch', err);
  }

  const taskAttributes = JSON.parse(task.attributes);

  const newAttributes = {
    ...taskAttributes,
    customers: {
      ...taskAttributes.customers,
      external_id: TaskSid,
    },
  };

  try {
    const updatedTask = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(event.TaskSid)
      .update({ attributes: JSON.stringify(newAttributes) });

    return { message: 'Task updated', updatedTask };
  } catch (err) {
    return logAndReturnError(event.TaskSid, context.TWILIO_WORKSPACE_SID, 'update', err);
  }
};

export type AddCustomerExternalId = typeof addCustomerExternalId;
