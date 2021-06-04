import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  success,
  error400,
  error500,
} from '@tech-matters/serverless-helpers';

export type Body = {
  EventType: string;
  TaskSid: string;
  TaskChannelUniqueName: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';
const VOICE_TASK_CHANNEL = 'voice';

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { EventType, TaskSid, TaskChannelUniqueName } = event;

  const isNewVoiceTask =
    EventType === TASK_CREATED_EVENT && TaskChannelUniqueName === VOICE_TASK_CHANNEL;

  if (!isNewVoiceTask) return resolve(success('Is not a new voice task'));

  try {
    const task = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(TaskSid)
      .fetch();

    const taskAttributes = JSON.parse(task.attributes);
    const { from } = taskAttributes;

    if (!from) {
      resolve(error400('Missing from attribute'));
    }

    taskAttributes.from = `${from}_${TaskSid}`;

    const updatedTask = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks(TaskSid)
      .update({ attributes: JSON.stringify(taskAttributes) });

    return resolve(success(updatedTask));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return resolve(error500(err));
  }
};
