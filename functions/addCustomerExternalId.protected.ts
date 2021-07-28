import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, success, error500 } from '@tech-matters/serverless-helpers';

export type Body = {
  EventType: string;
  TaskSid: string;
  TaskChannelUniqueName: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { EventType, TaskSid } = event;

  const isNewTask = EventType === TASK_CREATED_EVENT;

  if (!isNewTask) {
    resolve(success(JSON.stringify({ message: 'Is not a new task' })));
    return;
  }

  try {
    const task = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(TaskSid)
      .fetch();

    const taskAttributes = JSON.parse(task.attributes);
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
      .tasks(TaskSid)
      .update({ attributes: JSON.stringify(newAttributes) });

    resolve(success(JSON.stringify(updatedTask)));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
