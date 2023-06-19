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
import { omit } from 'lodash';
import type { WebhookEvent } from '../helpers/customChannels/flexToCustomChannel.private';
import { LexClient } from '../helpers/lexClient.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
};

export type Body = Partial<WebhookEvent> & {};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('===== chatbotCallback handler =====');

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { Body, From, ChannelSid, EventType } = event;
    if (!Body) {
      resolve(error400('Body'));
      return;
    }
    if (!From) {
      resolve(error400('From'));
      return;
    }
    if (!ChannelSid) {
      resolve(error400('ChannelSid'));
      return;
    }
    if (!EventType) {
      resolve(error400('EventType'));
      return;
    }

    const client = context.getTwilioClient();
    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(ChannelSid)
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

    // Send message to bot only if it's from child
    if (EventType === 'onMessageSent' && channelAttributes.fromServiceUser === From) {
      const handlerPath = Runtime.getFunctions()['helpers/lexClient'].path;
      const lexClient = require(handlerPath) as LexClient;

      const lexResponse = await lexClient.postText(context, {
        botName: channelAttributes.channelCapturedByBot.botName,
        botAlias: channelAttributes.channelCapturedByBot.botAlias,
        inputText: Body,
        userId: channel.sid,
      });

      await channel.messages().create({
        body: lexResponse.message,
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });

      // If the session ended, we should unlock the channel to continue the Studio Flow
      if (lexClient.isEndOfDialog(lexResponse.dialogState)) {
        const releasedChannelAttributes = {
          ...omit(channelAttributes, 'channelCapturedByBot'),
          memory: lexResponse.slots,
        };

        // TODO: This is now only assuming pre-survey bot. We should have a way to specify what's the next step after the bot execution is ended
        const nextAction = client.studio.v2
          .flows(channelAttributes.channelCapturedByBot.studioFlowSid)
          .executions.create({
            from: ChannelSid,
            to: ChannelSid,
            parameters: {
              ChannelAttributes: releasedChannelAttributes,
            },
          });

        await Promise.all([
          // Delete Lex session. This is not really needed as the session will expire, but that depends on the config of Lex.
          lexClient.deleteSession(context, {
            botName: channelAttributes.channelCapturedByBot.botName,
            botAlias: channelAttributes.channelCapturedByBot.botAlias,
            userId: channel.sid,
          }),
          // Update channel attributes (remove channelCapturedByBot and add memory)
          channel.update({
            attributes: JSON.stringify(releasedChannelAttributes),
          }),
          // Move control task to complete state
          client.taskrouter.v1
            .workspaces('WORKFLOW_SID')
            .tasks(channelAttributes.controlTaskSid)
            .update({ assignmentStatus: 'completed' }),
          // Remove this webhook from the channel
          channel
            .webhooks()
            .get(channelAttributes.channelCapturedByBot.chatbotCallbackWebhookSid)
            .remove(),
          // Trigger the next step once the channel is released
          nextAction,
        ]);

        console.log('Channel unblocked and bot session deleted');
      }

      resolve(success('All messages sent :)'));
      return;
    }

    resolve(success('Event ignored'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
