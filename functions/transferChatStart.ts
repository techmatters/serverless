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

export type Body = {
  taskSid?: string;
  targetSid?: string;
  workerName?: string;
  mode?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { taskSid, targetSid, workerName, mode } = event;

    try {
      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (workerName === undefined) {
        resolve(error400('workerName'));
        return;
      }
      if (mode === undefined) {
        resolve(error400('mode'));
        return;
      }

      // retrieve attributes of the original task
      const originalTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();

      const originalAttributes = JSON.parse(originalTask.attributes);

      const newAttributes = {
        ...originalAttributes,
        conversations: originalAttributes.conversation // set up attributes of the new task to link them to the original task in Flex Insights
          ? originalAttributes.conversation
          : { conversation_id: taskSid },
        ignoreAgent: workerName, // update task attributes to ignore the agent who transferred the task
        targetSid, // update task attributes to include the required targetSid on the task (workerSid or a queueSid)
        transferTargetType: targetSid.startsWith('WK') ? 'worker' : 'queue',
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
        // Set the channelSid and ProxySessionSID to a dummy value. This keeps the session alive
        const updatedAttributes = {
          ...originalAttributes,
          channelSid: 'CH00000000000000000000000000000000',
          proxySessionSID: 'KC00000000000000000000000000000000',
        };

        await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(taskSid)
          .update({ attributes: JSON.stringify(updatedAttributes) });

        // Close the original Task
        await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(taskSid)
          .update({ assignmentStatus: 'completed', reason: 'task transferred' });
      }

      resolve(success({ taskSid: newTask.sid }));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
