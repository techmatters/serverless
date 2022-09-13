import { validator } from 'twilio-flex-token-validator';
import { ServerlessFunctionSignature } from '@twilio-labs/serverless-runtime-types/types';

type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

const isWorker = (tokenResult: TokenValidatorResponse) =>
  tokenResult.worker_sid && tokenResult.worker_sid.startsWith('WK');
const isGuest = (tokenResult: TokenValidatorResponse) =>
  Array.isArray(tokenResult.roles) && tokenResult.roles.includes('guest');

type ExpectedContext = {
  ACCOUNT_SID?: string;
  AUTH_TOKEN?: string;
};

type ExpectedEvent = {
  Token?: string;
} & { request: { cookies: {}; headers: {} } };

export const functionValidator = (
  handlerFn: ServerlessFunctionSignature<ExpectedContext, ExpectedEvent>,
  options: { allowGuestToken?: boolean } = {},
): ServerlessFunctionSignature<ExpectedContext, ExpectedEvent> => {
  return (context, event, callback) => {
    const failedResponse = (message: string) => {
      const response = new Twilio.Response();
      response.appendHeader('Access-Control-Allow-Origin', '*');
      response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
      response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.appendHeader('Content-Type', 'plain/text');
      response.setStatusCode(403);
      response.setBody(message);

      callback(null, response);
    };

    const accountSid = context.ACCOUNT_SID;
    const authToken = context.AUTH_TOKEN;
    const token = event.Token;

    if (!accountSid || !authToken) {
      return failedResponse(
        'Unauthorized: AccountSid or AuthToken was not provided. For more information, please visit https://twilio.com/console/runtime/functions/configure',
      );
    }

    if (!token) {
      return failedResponse('Unauthorized: token was not provided.');
    }

    return validator(token, accountSid, authToken)
      .then((tokenResult: TokenValidatorResponse) => {
        const isGuestToken = !isWorker(tokenResult) || isGuest(tokenResult);

        if (isGuestToken && !options.allowGuestToken) {
          // throw new Error('Unauthorized: endpoint not open to guest tokens.');
          return failedResponse('Unauthorized: endpoint not open to guest tokens.');
        }

        const updatedEvent = { ...event, TokenResult: tokenResult };
        return handlerFn(context, updatedEvent, callback);
      })
      .catch(failedResponse);
  };
};

export type FunctionValidator = typeof functionValidator;
