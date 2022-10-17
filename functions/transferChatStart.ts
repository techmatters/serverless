/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  send,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';
import type { AdjustChatCapacityType } from './adjustChatCapacity';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
  CHAT_SERVICE_SID: string;
};

export type Body = {
  taskSid?: string;
  targetSid?: string;
  ignoreAgent?: string;
  mode?: string;
  memberToKick?: string;
  request: { cookies: {}; headers: {} };
};

async function closeTask(context: Context<EnvVars>, sid: string, taskToCloseAttributes: any) {
  // set the channelSid and ProxySessionSID to a dummy value. This keeps the session alive
  const newTaskToCloseAttributes = {
    ...taskToCloseAttributes,
    channelSid: 'CH00000000000000000000000000000000',
    proxySessionSID: 'KC00000000000000000000000000000000',
  };

  const client = context.getTwilioClient();

  await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(sid)
    .update({ attributes: JSON.stringify(newTaskToCloseAttributes) });

  // close the Task and set the proper status
  const closedTask = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(sid)
    .update({
      assignmentStatus: 'wrapping',
      reason: 'task transferred',
      attributes: JSON.stringify(newTaskToCloseAttributes),
    });

  return closedTask;
}

async function kickMember(context: Context<EnvVars>, memberToKick: string, chatChannel: string) {
  const client = context.getTwilioClient();

  // kick out the counselor that is not required anymore
  if (memberToKick) {
    const memberKicked = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(chatChannel)
      .members(memberToKick)
      .remove();

    return memberKicked;
  }

  return false;
}

async function closeTaskAndKick(
  context: Context<EnvVars>,
  body: Required<Pick<Body, 'taskSid' | 'targetSid' | 'ignoreAgent' | 'memberToKick' | 'mode'>>,
) {
  if (body.mode !== 'COLD') return null;

  const client = context.getTwilioClient();

  // retrieve attributes of the task to close
  const taskToClose = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.taskSid)
    .fetch();
  const taskToCloseAttributes = JSON.parse(taskToClose.attributes);
  const { channelSid } = taskToCloseAttributes;

  const [closedTask] = await Promise.all([
    closeTask(context, body.taskSid, taskToCloseAttributes),
    kickMember(context, body.memberToKick, channelSid),
  ]);

  return closedTask;
}

// if transfer targets a worker, validates that it can be effectively transferred, and if the worker's chat capacity needs to increase
async function validateChannelIfWorker(
  context: Context<EnvVars>,
  targetSid: string,
  transferTargetType: string,
  taskChannelUniqueName: string,
  channelType: string,
) {
  if (transferTargetType === 'queue') return { type: 'queue' } as const;

  const client = context.getTwilioClient();

  const [worker, workerChannel] = await Promise.all([
    client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).workers(targetSid).fetch(),
    client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .workers(targetSid)
      .workerChannels(taskChannelUniqueName)
      .fetch(),
  ]);

  if (!worker.available)
    return {
      type: 'error',
      payload: { status: 403, message: "Error: can't transfer to an offline counselor" },
    } as const;

  const workerAttr = JSON.parse(worker.attributes);

  const unavailableVoice = channelType === 'voice' && !workerChannel.availableCapacityPercentage;
  // if maxMessageCapacity is not set, just use configuredCapacity without adjustChatCapacity
  const unavailableChat = workerAttr.maxMessageCapacity
    ? channelType !== 'voice' &&
      !workerChannel.availableCapacityPercentage &&
      workerChannel.configuredCapacity >= workerAttr.maxMessageCapacity
    : channelType !== 'voice' && !workerChannel.availableCapacityPercentage;

  if (unavailableVoice || unavailableChat)
    return {
      type: 'error',
      payload: { status: 403, message: 'Error: counselor has no available capacity' },
    } as const;

  const shouldIncrease =
    workerAttr.maxMessageCapacity &&
    channelType !== 'voice' &&
    !workerChannel.availableCapacityPercentage &&
    workerChannel.configuredCapacity < workerAttr.maxMessageCapacity;

  return { type: 'worker', worker, shouldIncrease } as const;
}

async function increaseChatCapacity(
  context: Context<EnvVars>,
  validationResult: Awaited<ReturnType<typeof validateChannelIfWorker>>,
) {
  // once created the task, increase worker chat capacity if needed
  if (validationResult.shouldIncrease) {
    const { path } = Runtime.getFunctions().adjustChatCapacity;
    // eslint-disable-next-line prefer-destructuring
    const adjustChatCapacity: AdjustChatCapacityType = require(path).adjustChatCapacity;

    const { worker } = validationResult;

    const body = {
      workerSid: worker?.sid as string,
      adjustment: 'increase',
    } as const;

    await adjustChatCapacity(context, body);
  }
}

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { taskSid, targetSid, ignoreAgent, mode, memberToKick } = event;

    try {
      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (ignoreAgent === undefined) {
        resolve(error400('ignoreAgent'));
        return;
      }
      if (mode === undefined) {
        resolve(error400('mode'));
        return;
      }
      if (memberToKick === undefined) {
        resolve(error400('memberToKick'));
        return;
      }

      // retrieve attributes of the original task
      const originalTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();

      const originalAttributes = JSON.parse(originalTask.attributes);

      const transferTargetType = targetSid.startsWith('WK') ? 'worker' : 'queue';

      const validationResult = await validateChannelIfWorker(
        context,
        targetSid,
        transferTargetType,
        originalTask.taskChannelUniqueName,
        originalAttributes.channelType,
      );

      if (validationResult.type === 'error') {
        const { status, message } = validationResult.payload;
        resolve(send(status)({ status, message }));
        return;
      }

      const newAttributes = {
        ...originalAttributes,
        conversations: originalAttributes.conversation // set up attributes of the new task to link them to the original task in Flex Insights
          ? originalAttributes.conversation
          : { conversation_id: taskSid },
        ignoreAgent, // update task attributes to ignore the agent who transferred the task
        targetSid, // update task attributes to include the required targetSid on the task (workerSid or a queueSid)
        transferTargetType,
      };

      // create New task
      const newTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
          taskChannel: originalTask.taskChannelUniqueName,
          attributes: JSON.stringify(newAttributes),
          priority: 100,
        });

      // Final actions that might not happen (conditions specified inside of each)
      await Promise.all([
        increaseChatCapacity(context, validationResult),
        closeTaskAndKick(context, { mode, ignoreAgent, memberToKick, targetSid, taskSid }),
      ]);

      resolve(success({ taskSid: newTask.sid }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
