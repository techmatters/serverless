import { ServerlessCallback, TwilioResponse } from '@twilio-labs/serverless-runtime-types/types';

export { default as send } from './send';
export { default as responseWithCors } from './responseWithCors';
export * from './resolutions';
export * from './tokenValidator';

export type ResolveFunction = (cb: ServerlessCallback) => (res: TwilioResponse) => void;

/**
 * Binds callback and response to a function.
 * Used in combination with a resolution or send helpers
 * @example
 * import { responseWithCors, bindResolve, success, } from 'tech-matters-serverless-helpers';
 *
 * export const handler = (context, event, callback) => {
 *   const resolve = bindResolve(callback)(responseWithCors());
 *   const body = { prop1: value1, prop2: value2 };
 *   resolve(succes(body));
 * }
 *
 */
export const bindResolve = (cb: ServerlessCallback) => (res: TwilioResponse) => (
  f: ResolveFunction,
) => f(cb)(res);
