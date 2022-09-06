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
  error500,
  success,
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
  CHAT_SERVICE_SID: string;
};

export type Body = {
  closeSid?: string;
  keepSid?: string;
  memberToKick?: string;
  newStatus?: string;
  request: { cookies: {}; headers: {} };
};

async function closeTask(
  context: Context<EnvVars>,
  sid: string,
  taskToCloseAttributes: any,
  newStatus: string,
) {
  // set the channelSid and ProxySessionSID to a dummy value. This keeps the session alive
  const newTaskToCloseAttributes = {
    ...taskToCloseAttributes,
    transferMeta: {
      ...taskToCloseAttributes.transferMeta,
      transferStatus: newStatus,
    },
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
  body: Required<Pick<Body, 'closeSid' | 'keepSid' | 'memberToKick' | 'newStatus'>>,
) {
  const client = context.getTwilioClient();

  // retrieve attributes of the task to close
  const taskToClose = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.closeSid)
    .fetch();
  const taskToCloseAttributes = JSON.parse(taskToClose.attributes);
  const { channelSid } = taskToCloseAttributes;

  const [closedTask] = await Promise.all([
    closeTask(context, body.closeSid, taskToCloseAttributes, body.newStatus),
    kickMember(context, body.memberToKick, channelSid),
  ]);

  return closedTask;
}

async function updateTaskToKeep(
  context: Context<EnvVars>,
  body: Required<Pick<Body, 'closeSid' | 'keepSid' | 'memberToKick' | 'newStatus'>>,
) {
  const client = context.getTwilioClient();

  // retrieve attributes of the preserved task
  const taskToKeep = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.keepSid)
    .fetch();

  const taskToKeepAttributes = JSON.parse(taskToKeep.attributes);

  // update the status of the task that is preserved
  const newTaskToKeepAttributes = {
    ...taskToKeepAttributes,
    transferMeta: {
      ...taskToKeepAttributes.transferMeta,
      transferStatus: body.newStatus,
    },
  };

  const keptTask = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.keepSid)
    .update({ attributes: JSON.stringify(newTaskToKeepAttributes) });

  return keptTask;
}

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { closeSid, keepSid, memberToKick, newStatus } = event;

    try {
      if (closeSid === undefined) {
        resolve(error400('closeSid'));
        return;
      }
      if (keepSid === undefined) {
        resolve(error400('keepSid'));
        return;
      }
      if (memberToKick === undefined) {
        resolve(error400('memberToKick'));
        return;
      }
      if (newStatus === undefined) {
        resolve(error400('newStatus'));
        return;
      }

      const validBody = {
        closeSid,
        keepSid,
        memberToKick,
        newStatus,
      };

      const [closedTask, keptTask] = await Promise.all([
        closeTaskAndKick(context, validBody),
        updateTaskToKeep(context, validBody),
      ]);

      resolve(success({ closed: closedTask.sid, kept: keptTask.sid }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
