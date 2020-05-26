import { ServerlessCallback, TwilioResponse } from '@twilio-labs/serverless-runtime-types/types';

export { default as send } from './send';
export { default as responseWithCors } from './responseWithCors';
export * from './resolutions';

export type ResolveFunction = (cb: ServerlessCallback) => (res: TwilioResponse) => void;

/**
 * Binds callback and response to a function.
 * Used in combination with send (or a resolution) to avoid the unclear style of callback(null, response)
 */
export const bindResolve = (cb: ServerlessCallback) => (res: TwilioResponse) => (
  f: ResolveFunction,
) => f(cb)(res);
