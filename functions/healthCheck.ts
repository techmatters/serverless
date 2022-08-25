import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

export type Body = {
  language?: string;
  request: { cookies: {}; headers: {} };
};

export const handler: ServerlessFunctionSignature = async (
  context: Context,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const msg = 'serverless is up and running!';
  try {
    resolve(success(msg));
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
