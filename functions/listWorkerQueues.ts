import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import type { FunctionValidator } from './helpers/tokenValidator';

const functionValidatorPath = Runtime.getFunctions()['helpers/tokenValidator'].path;
// eslint-disable-next-line import/no-dynamic-require, global-require
const TokenValidator = require(functionValidatorPath).functionValidator as FunctionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  workerSid?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
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
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
