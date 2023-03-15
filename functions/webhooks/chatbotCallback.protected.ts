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
import AWS from 'aws-sdk';
import type { MessageInstance } from 'twilio/lib/rest/chat/v2/service/channel/message';
import { omit } from 'lodash';
import type { WebhookEvent } from '../helpers/customChannels/flexToCustomChannel.private';

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
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { Body, From, ChannelSid, EventType } = event;
    if (Body === undefined) {
      resolve(error400('Body'));
      return;
    }
    if (From === undefined) {
      resolve(error400('From'));
      return;
    }
    if (ChannelSid === undefined) {
      resolve(error400('ChannelSid'));
      return;
    }
    if (EventType === undefined) {
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
    if (EventType === 'onMessageSent' && channelAttributes.from === From) {
      // ==============
      /**
       * TODO: Factor out shared chunk of code
       */
      AWS.config.update({
        credentials: {
          accessKeyId: context.ASELO_APP_ACCESS_KEY,
          secretAccessKey: context.ASELO_APP_SECRET_KEY,
        },
        region: context.AWS_REGION,
      });

      const Lex = new AWS.LexRuntimeV2();

      const lexResponse = await Lex.recognizeText({
        botId: channelAttributes.channelCapturedByBot.botId,
        botAliasId: channelAttributes.channelCapturedByBot.botAliasId,
        localeId: channelAttributes.channelCapturedByBot.localeId,
        text: Body,
        sessionId: channel.sid, // We could use some channel/bot info to better scope this
      }).promise();

      // Secuentially wait for the messages to be sent in the correct order
      // TODO: probably we want to handle the case where messages is null
      /* const messagesSent = */ await lexResponse.messages?.reduce<Promise<MessageInstance[]>>(
        async (accumPromise, message) => {
          // TODO: this is unlikely to fail, but maybe we should handle differently?
          const resolved = await accumPromise; // wait for previous promise to resolve
          const sent = await channel.messages().create({
            body: message.content,
            from: 'Bot',
            xTwilioWebhookEnabled: 'true',
          });

          return [...resolved, sent];
        },
        Promise.resolve([]),
      );
      // ==============

      // If the session ended, we should unlock the channel to continue the Studio Flow
      // TODO: raise the discussion. This could be done from a Lambda that's called when the bot
      //       finishes the convo. Unfortunately, AWS only allows Lambdas there, so it may require some more work
      if (lexResponse.sessionState?.dialogAction?.type === 'Close') {
        const releasedChannelAttributes = omit(channelAttributes, 'channelCapturedByBot');

        await Promise.all([
          // Delete Lex session. This is not really needed as the session will expire, but that depends on the config of Lex.
          Lex.deleteSession({
            botId: channelAttributes.channelCapturedByBot.botId,
            botAliasId: channelAttributes.channelCapturedByBot.botAliasId,
            localeId: channelAttributes.channelCapturedByBot.localeId,
            sessionId: channel.sid,
          }).promise(),
          // Remove channelCapturedByBot from channel attributes
          channel.update({
            attributes: JSON.stringify(releasedChannelAttributes),
          }),
          // Trigger a new API type Studio Flow execution once the channel is released
          client.studio.v2
            .flows(channelAttributes.channelCapturedByBot.studioFlowSid)
            .executions.create({
              from: From,
              to: ChannelSid,
              parameters: {
                ChannelAttributes: {
                  ...releasedChannelAttributes,
                  memory: lexResponse.interpretations,
                },
              },
            }),
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
