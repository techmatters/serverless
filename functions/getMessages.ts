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

export type Body = {
  language?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { language } = event;

    try {
      if (language === undefined) {
        resolve(error400('language'));
        return;
      }

      const translation = Runtime.getAssets()[`/translations/${language}/messages.json`].open();

      resolve(success(translation));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
