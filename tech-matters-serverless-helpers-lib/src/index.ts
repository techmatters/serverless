/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

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
