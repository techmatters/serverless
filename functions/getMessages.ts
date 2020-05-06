import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
  TwilioResponse,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

// TODO: Factor out into lib
const send = (statusCode: number) => (body: string | object) => (callback: ServerlessCallback) => (
  response: TwilioResponse,
) => {
  response.setStatusCode(statusCode);
  response.setBody(body);
  callback(null, response);
};

// TODO: Factor out into lib
const responseWithCors = () => {
  const response = new Twilio.Response();

  response.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });

  return response;
};

type Body = {
  language?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = responseWithCors();

    try {
      const body = event as Body;
      const { language } = body;

      if (language === undefined) {
        const err = { message: 'Error: language parameter not provided', status: 400 };
        send(400)(err)(callback)(response);
        return;
      }

      const translation = Runtime.getAssets()[`/translations/${language}/messages.json`].open();

      send(200)(translation)(callback)(response);
    } catch (err) {
      send(500)(err)(callback)(response);
    }
  },
);
