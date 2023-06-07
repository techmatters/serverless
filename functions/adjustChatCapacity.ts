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

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  send,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  workerSid?: string;
  adjustment?: 'increase' | 'decrease';
  request: { cookies: {}; headers: {} };
};

export const adjustChatCapacity = async (
  context: Context<EnvVars>,
  body: Required<Pick<Body, 'adjustment' | 'workerSid'>>,
): Promise<{ status: number; message: string }> => {
  const client = context.getTwilioClient();

  const worker = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .workers(body.workerSid)
    .fetch();

  if (!worker) return { status: 404, message: 'Could not find worker.' };

  const attributes = JSON.parse(worker.attributes);
  const maxMessageCapacity = parseInt(attributes.maxMessageCapacity, 10);

  if (!maxMessageCapacity) {
    return {
      status: 409,
      message: `Worker ${body.workerSid} does not have a "maxMessageCapacity" attribute, can't adjust capacity.`,
    };
  }

  const channels = await worker.workerChannels().list();
  const channel = channels.find((c) => c.taskChannelUniqueName === 'chat');

  if (!channel) return { status: 404, message: 'Could not find chat channel.' };

  if (body.adjustment === 'increase') {
    if (channel.availableCapacityPercentage > 0) {
      return { status: 412, message: 'Still have available capacity, no need to increase.' };
    }

    if (!(channel.configuredCapacity < maxMessageCapacity)) {
      return { status: 412, message: 'Reached the max capacity.' };
    }

    await channel.update({ capacity: channel.configuredCapacity + 1 });
    return { status: 200, message: 'Successfully increased channel capacity' };
  }

  if (body.adjustment === 'decrease') {
    if (channel.configuredCapacity - 1 >= 1) {
      await channel.update({ capacity: channel.configuredCapacity - 1 });
    }

    // If configuredCapacity is already 1, send status 200 to avoid error on client side
    return { status: 200, message: 'Successfully decreased channel capacity' };
  }

  return { status: 400, message: 'Invalid adjustment argument' };
};

export type AdjustChatCapacityType = typeof adjustChatCapacity;

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workerSid, adjustment } = event;

    try {
      if (workerSid === undefined) return resolve(error400('workerSid'));
      if (adjustment === undefined) return resolve(error400('adjustment'));

      const validBody = { workerSid, adjustment };

      const { status, message } = await adjustChatCapacity(context, validBody);

      return resolve(send(status)({ message, status }));
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
