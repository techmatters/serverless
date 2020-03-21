import { ServerlessCallback, TwilioResponse } from '@twilio-labs/serverless-runtime-types/types';

export const send = (response: TwilioResponse) => (statusCode: number) => (
  body: string | object,
) => (callback: ServerlessCallback) => {
  response.setStatusCode(statusCode);
  response.setBody(body);
  callback(null, response);
};
