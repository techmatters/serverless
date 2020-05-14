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
} from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type Event = {
  language?: string;
};

type Body = Required<Event>;

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: Event, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      if (event.language === undefined) {
        resolve(error400('language'));
        return;
      }

      const { language } = event as Body;

      const translation = Runtime.getAssets()[`/translations/${language}/messages.json`].open();

      resolve(success(translation));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
