import { Context } from '@twilio-labs/serverless-runtime-types/types';

export type Body = {
  EventType: string;
  TaskSid?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

export const addTaskSidToChannelAttributes = async (context: Context<EnvVars>, event: Body) => {
  console.log(' ----- addTaskSidToChannelAttributes execution starts ----- ');
  const client = context.getTwilioClient();
  const { TaskSid } = event;

  if (TaskSid === undefined || !TaskSid) {
    throw new Error('TaskSid missing in event object');
  }

  const task = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(TaskSid)
    .fetch();
  console.log('>task in trc', task);

  const { channelSid } = JSON.parse(task.attributes);

  // Fetch channel to update with a taskId
  const channel = await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).fetch();

  const updatedChannel = await channel.update({
    attributes: JSON.stringify({
      ...JSON.parse(channel.attributes),
      taskSid: task.sid,
    }),
  });
  console.log('>updatedTask in trc', updatedChannel);

  return { message: 'Channel is updated', updatedChannel };
};

export type AddTaskSidToChannelAttributes = typeof addTaskSidToChannelAttributes;
