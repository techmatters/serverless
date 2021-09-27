// eslint-disable-next-line prettier/prettier
import type { Context } from '@twilio-labs/serverless-runtime-types/types';

export type Body = {
  EventType: string;
  TaskSid?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';

export const addCustomerExternalId = async (context: Context<EnvVars>, event: Body) => {
  console.log('-------- addCustomerExternalId execution --------');

  const { EventType, TaskSid } = event;

  const isNewTask = EventType === TASK_CREATED_EVENT;

  if (!isNewTask) {
    return { message: `Event is not ${TASK_CREATED_EVENT}` };
  }

  if (!event.TaskSid) throw new Error('TaskSid missing in event object');

  const task = await context
    .getTwilioClient()
    .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(event.TaskSid)
    .fetch();

  const taskAttributes = JSON.parse(task.attributes);

  if (taskAttributes.isContactlessTask) {
    // this case is already handled when the task is created, in assignOfflineContact function
    return { message: 'Is contactless task' };
  }

  const newAttributes = {
    ...taskAttributes,
    customers: {
      ...taskAttributes.customers,
      external_id: TaskSid,
    },
  };

  const updatedTask = await context
    .getTwilioClient()
    .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(event.TaskSid)
    .update({ attributes: JSON.stringify(newAttributes) });

  return { message: 'Task updated', updatedTask };
};

export type AddCustomerExternalId = typeof addCustomerExternalId;
