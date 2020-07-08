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

export type Body = {
  language?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { language } = event;

    try {
      if (language === undefined) {
        resolve(error400('language'));
        return;
      }

      const translation = Runtime.getAssets()[`/translations/${language}/flexUI.json`].open();

      resolve(success(translation));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
