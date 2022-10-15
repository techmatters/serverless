// eslint-disable-next-line prettier/prettier
import type { Context } from '@twilio-labs/serverless-runtime-types/types';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';

export type Body = {
  EventType: string;
  TaskSid?: string;
};

export type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';

const logAndReturnError = (
  taskSid: TaskInstance['sid'],
  workspaceSid: EnvVars['TWILIO_WORKSPACE_SID'],
  step: 'fetch' | 'update',
  errorInstance: unknown,
) => {
  const errorMessage = `Error at addCustomerExternalId: task with sid ${taskSid} does not exists in workspace ${workspaceSid} when trying to ${step} it.`;
  console.error(errorMessage, errorInstance);
  return { message: errorMessage };
};

export const addCustomerExternalId = async (context: Context<EnvVars>, event: Body) => {
  console.log('-------- addCustomerExternalId execution --------');

  const { EventType, TaskSid } = event;

  const isNewTask = EventType === TASK_CREATED_EVENT;

  if (!isNewTask) {
    return { message: `Event is not ${TASK_CREATED_EVENT}` };
  }

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
