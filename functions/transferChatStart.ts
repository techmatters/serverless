import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error403,
  error500,
  success,
} from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

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

async function closeTaskAndKick(context: Context<EnvVars>, body: Required<Body>) {
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

export const handler: ServerlessFunctionSignature = TokenValidator(
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

      const transferTargetType = targetSid.startsWith('WK') ? 'worker' : 'queue';

      if (transferTargetType === 'worker') {
        const worker = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .workers(targetSid)
          .fetch();

        if (!worker.available) {
          resolve(error403("Error: can't transfer to an offline counselor"));
          return;
        }

        const workerChannel = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .workers(targetSid)
          .workerChannels(originalTask.taskChannelSid)
          .fetch();

        if (!workerChannel.availableCapacityPercentage) {
          resolve(error403('Error: counselor has no available capacity'));
          return;
        }
      }

      const originalAttributes = JSON.parse(originalTask.attributes);

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
        });

      if (mode === 'COLD') {
        const validBody = { taskSid, targetSid, ignoreAgent, mode, memberToKick };
        await closeTaskAndKick(context, validBody);
      }

      resolve(success({ taskSid: newTask.sid }));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
