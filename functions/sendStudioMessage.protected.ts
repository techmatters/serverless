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

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */

import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { bindResolve, error500, responseWithCors, send } from '@tech-matters/serverless-helpers';
import { Body, EnvVars as SendSystemEnv, SendSystemMessageModule } from './sendSystemMessage';

export const handler: ServerlessFunctionSignature<SendSystemEnv, Body> = async (
  context: Context<SendSystemEnv>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const handlerPath = Runtime.getFunctions().sendSystemMessage.path;
    const { sendSystemMessage } = require(handlerPath) as SendSystemMessageModule;

    const result = await sendSystemMessage(context, event);

    resolve(send(result.status)(result.message));
  } catch (err: any) {
    resolve(error500(err));
  }
};
