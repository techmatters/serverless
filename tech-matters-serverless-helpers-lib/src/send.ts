import { ServerlessCallback, TwilioResponse } from '@twilio-labs/serverless-runtime-types/types';

const send = (statusCode: number) => (body: string | object) => (callback: ServerlessCallback) => (
  response: TwilioResponse,
) => {
  response.setStatusCode(statusCode);
  response.setBody(body);
  callback(null, response);
};

export default send;
