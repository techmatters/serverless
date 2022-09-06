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
};

export type Body = {
  targetSid?: string;
  transferTargetType?: string;
  helpline?: string;
  request: { cookies: {}; headers: {} };
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { targetSid, transferTargetType, helpline } = event;

    try {
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (transferTargetType === undefined) {
        resolve(error400('transferTargetType'));
        return;
      }
      if (helpline === undefined) {
        resolve(error400('helpline'));
        return;
      }

      const newAttributes = {
        targetSid,
        transferTargetType,
        helpline,
        channelType: 'default',
        isContactlessTask: true,
      };

      // create New task
      const newTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
          taskChannel: 'default',
          attributes: JSON.stringify(newAttributes),
          priority: 100,
        });

      resolve(success(newTask));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
