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

import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export interface Event {
  Channel: string;
  CurrentTask: string;
  Memory: string;
  UserIdentifier: string;
  request: { cookies: {}; headers: {} };
}

type EnvVars = {};

const handleChatChannel = async (context: Context<EnvVars>, event: Event) => {
  const memory = JSON.parse(event.Memory);
  const { ServiceSid, ChannelSid } = memory.twilio.chat;

  const channel = await context
    .getTwilioClient()
    .chat.services(ServiceSid)
    .channels(ChannelSid)
    .fetch();

  const attributes = JSON.parse(channel.attributes);

  // if channel is webchat, disable the input
  if (attributes.channel_type === 'web') {
    const user = await context
      .getTwilioClient()
      .chat.services(ServiceSid)
      .users(event.UserIdentifier)
      .fetch();

    const userAttr = JSON.parse(user.attributes);
    const updatedAttr = { ...userAttr, lockInput: true };

    await user.update({ attributes: JSON.stringify(updatedAttr) });
  }
};

const buildActionsArray = (context: Context<EnvVars>, event: Event) => {
  const memory = JSON.parse(event.Memory);

  switch (memory.at) {
    case 'survey': {
      const redirect = { redirect: 'task://counselor_handoff' };
      return [redirect];
    }
    default: {
      // If we ever get here, it's in error
      // Just handoff to counselor for now, maybe need to internally record an error
      const redirect = { redirect: 'task://counselor_handoff' };
      return [redirect];
    }
  }
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  try {
    if (event.Channel === 'chat' && event.CurrentTask === 'redirect_function')
      await handleChatChannel(context, event);

    const actions = buildActionsArray(context, event);
    const returnObj = { actions };

    callback(null, returnObj);
  } catch (err: any) {
    // If something goes wrong, just handoff to counselor so contact is not lost
    callback(null, { actions: [{ redirect: 'task://counselor_handoff' }] });
  }
};
