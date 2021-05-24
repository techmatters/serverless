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
};

export type Body = {
  workerSid?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workerSid } = event;

    try {
      if (workerSid === undefined) return resolve(error400('workerSid'));

      const workerQueues = await context
        .getTwilioClient()
        .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
        .taskQueues.list({ workerSid });

      return resolve(success({ workerQueues }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
