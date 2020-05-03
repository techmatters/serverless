import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
  TwilioResponse,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

const send = (response: TwilioResponse) => (statusCode: number) => (body: string | object) => (
  callback: ServerlessCallback,
) => {
  response.setStatusCode(statusCode);
  response.setBody(body);
  callback(null, response);
};

type Body = {
  language: string | undefined;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');
    try {
      const body = event as Body;
      const { language } = body;

      if (language === undefined) {
        const err = { message: 'Error: language parameter not provided', status: 400 };
        send(response)(400)(err)(callback);
        return;
      }

      const { path } = Runtime.getAssets()[`/translations/${language}/flexUI.json`];
      const translation = require(path);

      send(response)(200)(translation)(callback);
    } catch (err) {
      send(response)(500)(err)(callback);
    }
  },
);
