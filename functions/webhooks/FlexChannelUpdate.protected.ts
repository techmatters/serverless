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
  success,
} from '@tech-matters/serverless-helpers';
import { ConversationState } from 'twilio/lib/rest/conversations/v1/conversation';
import { ConversationSid } from '../helpers/customChannels/customChannelToFlex.private';
import { CleanupUserChannelMap } from '../helpers/chatChannelJanitor.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
};

type ConversationEventBody = {
  EventType:
    | 'onConversationStateUpdated'
    | 'conversationUpdated'
    | 'conversationRemoved'
    | 'onMessageAdded';
  ConversationSid: ConversationSid;
};

type ConversationStateUpdatedBody = ConversationEventBody & {
  EventType: 'onConversationStateUpdated';
  StateFrom: ConversationState;
  StateTo: ConversationState;
};

type ChannelUpdatedBody = {
  Source?: string;
  ChannelSid?: string; // Remove once we've fully migrated to conversations
  Attributes?: string; // channel attributes (e.g. "{\"from\":\"pgian\",\"channel_type\":\"custom\",\"status\":\"INACTIVE\",\"long_lived\":false}")
  UniqueName?: string;
  FriendlyName?: string;
  ClientIdentity?: string; // client firing the channel update
  CreatedBy?: string;
  EventType: 'onChannelUpdated';
  InstanceSid?: string;
  DateCreated?: string;
  DateUpdated?: string;
  AccountSid?: string;
  RetryCount?: string;
  WebhookType?: string;
  ChannelType?: string;
  WebhookSid?: string;
};

export type Body = ChannelUpdatedBody | ConversationEventBody;

function timeout(ms: number) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('=== FlexChannelUpdate.protected ===');
  Object.entries(event).forEach(([key, value]) => {
    console.log(`${key}: ${value}`);
  });
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);
  // eslint-disable-next-line global-require,import/no-dynamic-require
  const cleanupUserChannelMap = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
    .cleanupUserChannelMap as CleanupUserChannelMap;

  try {
    const client = context.getTwilioClient();

    if (event.EventType === 'onChannelUpdated') {
      const { ChannelSid } = event;

      if (ChannelSid === undefined) {
        resolve(error400('ChannelSid'));
        return;
      }

      const channel = await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(ChannelSid)
        .fetch();

      const { status, from } = JSON.parse(channel.attributes);

      if (status === 'INACTIVE') {
        await timeout(1000); // set small timeout just in case some cleanup is still going on

        const removed = await cleanupUserChannelMap(context, from);

        resolve(success(`INACTIVE channel triggered map removal for ${from}, removed ${removed}`));
        return;
      }
    } else {
      const { ConversationSid: conversationSid } = event;
      console.log(
        `Checking if map removal for ${conversationSid} is required (${event.EventType})}`,
      );
      let StateFrom: ConversationState | 'UNKNOWN' = 'UNKNOWN';
      if (event.EventType === 'onConversationStateUpdated') {
        ({ StateFrom } = event as ConversationStateUpdatedBody);
      }

      if (conversationSid === undefined) {
        resolve(error400('ConversationSid'));
        return;
      }

      const conversation = await client.conversations.conversations(conversationSid).fetch();

      const { twilioNumber } = JSON.parse(conversation.attributes);

      if (conversation.state !== 'active') {
        console.log(
          `State changed from ${StateFrom} to ${conversation.state}, attempting map removal for ${twilioNumber}`,
        );
        await timeout(1000); // set small timeout just in case some cleanup is still going on

        const removed = await cleanupUserChannelMap(context, twilioNumber);
        console.log(
          `State changed from ${StateFrom} to ${conversation.state} for ${twilioNumber}, successfully removed ${removed}`,
        );
        resolve(
          success(
            `State changed from ${StateFrom} to ${conversation.state} triggered map removal for ${twilioNumber}, removed ${removed}`,
          ),
        );
        console.log(
          `State changed from ${StateFrom} to ${conversation.state} completed map removal for ${conversationSid} (${twilioNumber} - ${removed})`,
        );
        return;
      }
    }

    resolve(success('Ignored event.'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
