import { validator, HandlerFn } from 'twilio-flex-token-validator';

type TokenValidatorResponse = { worker_sid?: string; roles?: string[] };

const isWorker = (tokenResult: TokenValidatorResponse) =>
  tokenResult.worker_sid && tokenResult.worker_sid.startsWith('WK');
const isGuest = (tokenResult: TokenValidatorResponse) =>
  Array.isArray(tokenResult.roles) && tokenResult.roles.includes('guest');

export const functionValidator = (
  handlerFn: HandlerFn,
  options: { allowGuestToken?: boolean } = {},
): HandlerFn => {
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
