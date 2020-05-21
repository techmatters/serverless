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
} from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

type Event = {
  closeSid?: string;
  keepSid?: string;
  newStatus?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Event, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { closeSid, keepSid, newStatus } = event;

    try {
      if (closeSid === undefined) {
        resolve(error400('closeSid'));
        return;
      }
      if (keepSid === undefined) {
        resolve(error400('keepSid'));
        return;
      }

      // retrieve attributes of the closing task
      const closingTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(closeSid)
        .fetch();

      const closingAttributes = JSON.parse(closingTask.attributes);

      // Set the channelSid and ProxySessionSID to a dummy value. This keeps the session alive
      const updatedClosingAttributes = {
        ...closingAttributes,
        channelSid: 'CH00000000000000000000000000000000',
        proxySessionSID: 'KC00000000000000000000000000000000',
      };

      await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(closeSid)
        .update({ attributes: JSON.stringify(updatedClosingAttributes) });

      // Close the Task and set the propper status
      const closedTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(closeSid)
        .update({
          assignmentStatus: 'completed',
          reason: 'task transferred',
          attributes: JSON.stringify({
            ...updatedClosingAttributes,
            transferMeta: {
              ...updatedClosingAttributes.transferMeta,
              transferStatus: newStatus || 'completed',
            },
          }),
        });

      // retrieve attributes of the closing task
      const keepingTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(keepSid)
        .fetch();

      const keepingAttributes = JSON.parse(keepingTask.attributes);

      // update the status of the task that is kept
      const updatedKeepingAttributes = {
        ...keepingAttributes,
        transferMeta: {
          ...keepingAttributes.transferMeta,
          transferStatus: newStatus || 'completed',
        },
      };

      const keptTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(keepSid)
        .update({ attributes: JSON.stringify(updatedKeepingAttributes) });

      resolve(success({ closed: closedTask.sid, kept: keptTask.sid }));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
