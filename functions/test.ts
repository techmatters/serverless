import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';
import type { FunctionValidator } from './helpers/tokenValidator';

const functionValidatorPath = Runtime.getFunctions()['helpers/tokenValidator'].path;
// eslint-disable-next-line import/no-dynamic-require, global-require
const TokenValidator = require(functionValidatorPath).functionValidator as FunctionValidator;

export type Body = {
  language?: string;
  request: { cookies: {}; headers: {} };
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const msg = 'yup, this is allowed!';
    try {
      resolve(success(msg));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  {
    allowGuestToken: true,
  },
);
