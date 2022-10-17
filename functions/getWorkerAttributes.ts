import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

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

    try {
      const { workerSid } = event;

      if (workerSid === undefined) {
        resolve(error400('workerSid'));
        return;
      }

      const client = context.getTwilioClient();
      const worker = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .workers(workerSid)
        .fetch();

      const workerAttributes = JSON.parse(worker.attributes);

      if (workerAttributes.helpline === undefined)
        throw new Error(
          'Error: the target worker does not have helpline attribute set, check the worker configuration.',
        );

      const whiteListedAttributes = {
        helpline: workerAttributes.helpline,
      };

      resolve(success(whiteListedAttributes));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
