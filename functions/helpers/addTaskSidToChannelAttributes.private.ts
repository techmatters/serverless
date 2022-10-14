import { Context } from '@twilio-labs/serverless-runtime-types/types';

export type Body = {
  EventType: string;
  TaskSid?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';

export const addTaskSidToChannelAttributes = async (context: Context<EnvVars>, event: Body) => {
  const client = context.getTwilioClient();
  const { EventType, TaskSid } = event;

  const isNewTask = EventType === TASK_CREATED_EVENT;

  if (!isNewTask) {
    return { message: `Event is not ${TASK_CREATED_EVENT}` };
  }
  if (TaskSid === undefined || !TaskSid) {
    throw new Error('TaskSid missing in event object');
  }

  const task = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(TaskSid)
    .fetch();

  const { channelSid } = JSON.parse(task.attributes);

  // Fetch channel to update with a taskId
  const channel = await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).fetch();

  const updatedTask = await channel.update({
    attributes: JSON.stringify({
      ...JSON.parse(channel.attributes),
      taskSid: task.sid,
    }),
  });

  return { message: 'Task updated', updatedTask };
};

export type AddTaskSidToChannelAttributes = typeof addTaskSidToChannelAttributes;
