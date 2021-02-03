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
  taskSid?: string;
  message?: string;
  from?: string
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { taskSid, message, from } = event;

    try {
      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }

      if (message === undefined) {
        resolve(error400('message'));
        return;
      }

      const client = context.getTwilioClient();

      const task = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks(taskSid)
        .fetch();
      const taskToCloseAttributes = JSON.parse(task.attributes);
      const { channelSid } = taskToCloseAttributes;

      await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .messages.create({ body: message, from });

      resolve(success('Message sent'));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
