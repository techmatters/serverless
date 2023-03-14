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
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  CHAT_SERVICE_SID: string;
};

type Body = {
  channelSid: string;
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { channelSid } = event;

    if (channelSid === undefined) {
      resolve(error400('channelSid'));
      return;
    }

    const channel = await context
      .getTwilioClient()
      .chat.v2.services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

    /**
     * Remove the 'studio' type webhook so further messages does not start a new Studio execution
     * NOTE: is extremely important to "cleanup" (with Janitor) the channels where this is done, or they'll stay in a stuck state.
     */
    // This is also used in functions/sendMessageAndRunJanitor.protected.ts, maybe factor out
    const channelWebhooks = await context
      .getTwilioClient()
      .chat.services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .webhooks.list();

    // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
    await Promise.all(
      channelWebhooks.map(async (w) => {
        if (w.type === 'studio') {
          await w.remove();
        }
      }),
    );

    await channel.update({
      attributes: JSON.stringify({
        ...channelAttributes,
        channelCapturedByBot: {
          botId: 'C6HUSTIFBR', // This should be passed as parameter
          botAliasId: 'TSTALIASID', // This should be passed as parameter
          localeId: 'en_US', // This should be passed as parameter
        },
      }),
    });

    resolve(success('Channel caputer by bot =)'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
