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
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
};

export type Body = {
  serviceSid: string;
  mediaSid: string;
};

export type Event = {
  serviceSid: string;
  mediaSid: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Event, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { serviceSid, mediaSid } = event;

      if (!serviceSid) return resolve(error400('serviceSid'));
      if (!mediaSid) return resolve(error400('mediaSid'));

      const body: Body = {
        serviceSid,
        mediaSid,
      };

      const username = context.ACCOUNT_SID;
      const password = context.AUTH_TOKEN;
      const url = `https://mcs.us1.twilio.com/v1/Services/${body.serviceSid}/Media/${body.mediaSid}`;

      const hash = Buffer.from(`${username}:${password}`).toString('base64');

      const media = await axios.request({
        method: 'get',
        url,
        headers: {
          Authorization: `Basic ${hash}`,
        },
        validateStatus: () => true, // always resolve the promise to redirect the response in case of response out of 2xx range
      });

      return resolve(send(media.status)(media.data));
    } catch (err) {
      return resolve(error500(err as any));
    }
  },
);
