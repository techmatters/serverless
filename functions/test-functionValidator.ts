import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  success,
  functionValidator,
} from '@tech-matters/serverless-helpers';

export type Body = {
  language?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = functionValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const msg = 'This is allowed :D, welcome in!';
    try {
      resolve(success(msg));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
