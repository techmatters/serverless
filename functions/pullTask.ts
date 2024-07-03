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

import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  bindResolve,
  error400,
  functionValidator as TokenValidator,
  responseWithCors,
  send,
  success,
} from '@tech-matters/serverless-helpers';
import { AdjustChatCapacityType } from './adjustChatCapacity';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

type Body = {
  workerSid: string;
  request: { cookies: {}; headers: {} };
};

const PULL_ATTEMPT_TIMEOUT_MS = 5000;

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Increases chat capacity for a worker and then waits a specified period for another task to be assigned from the queue
 * It polls the workers reservations to see if a new task has been assigned for this period. If a new task is assigned, it returns 200 with the taskSid
 * If no task is assigned, it returns 404 - no task found? Possible stretching the definition of a 404 slightly here :-).
 */
export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('==== pullTask ====');
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    const { workerSid } = event;

    if (!workerSid) return resolve(error400('workerSid'));

    const client = context.getTwilioClient();
    const { path } = Runtime.getFunctions().adjustChatCapacity;

    // eslint-disable-next-line global-require,import/no-dynamic-require,prefer-destructuring
    const adjustChatCapacity: AdjustChatCapacityType = require(path).adjustChatCapacity;

    const body = {
      workerSid,
      adjustment: 'increase',
    } as const;
    const initialWorkerReservationSids = new Set(
      (
        await client.taskrouter.workspaces
          .get(context.TWILIO_WORKSPACE_SID)
          .workers.get(workerSid)
          .reservations.list()
      ).map((r) => r.sid),
    );

    await adjustChatCapacity(context, body);
    const pullAttemptExpiry = Date.now() + PULL_ATTEMPT_TIMEOUT_MS;

    // Polling is much more self contained and less messy than event driven with the backend TaskRouter API
    while (Date.now() < pullAttemptExpiry) {
      // eslint-disable-next-line no-await-in-loop
      await delay(500);
      // eslint-disable-next-line no-await-in-loop
      const currentReservations = await client.taskrouter.workspaces
        .get(context.TWILIO_WORKSPACE_SID)
        .workers.get(workerSid)
        .reservations.list();
      for (const reservation of currentReservations) {
        if (!initialWorkerReservationSids.has(reservation.sid)) {
          console.log('New task reserved for worker pulled:', reservation.taskSid);
          resolve(success({ taskPulled: reservation.taskSid }));
        }
      }
    }
    return resolve(send(404)({ message: 'No task found to pull' }));
  },
);
