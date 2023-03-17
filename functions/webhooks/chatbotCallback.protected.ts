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
import dialogflow from '@google-cloud/dialogflow';
import { omit } from 'lodash';
import type { WebhookEvent } from '../helpers/customChannels/flexToCustomChannel.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
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
    if (EventType === 'onMessageSent' && channelAttributes.fromServiceUser === From) {
      // ==============
      /**
       * TODO: Factor out shared chunk of code
       */
      // google requires an environment variable called GOOGLE_APPLICATION_CREDENTIALS that points to a file path with the service account key file (json) to authenticate into their API
      // to solve for this, we save the key file as a private asset, then use a helper function to find and return the path of the private asset.
      // lastly we set the environment variable dynamically at runtime so that it's in place when the sessions client is initialized
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
        Runtime.getAssets()['/service-account-key.json'].path;

      // Create a new session
      const sessionClient = new dialogflow.SessionsClient();

      const request = {
        session: sessionClient.projectAgentSessionPath(
          channelAttributes.channelCapturedByBot.projectId, // projectId
          channel.sid, // sessionId
        ),
        queryInput: {
          text: {
            // The query to send to the dialogflow agent
            text: Body,
            // The language used by the client (en-US)
            languageCode: channelAttributes.channelCapturedByBot.languageCode,
          },
        },
      };

      // Only the first element of the touple seemed relevant so far
      const [dialogflowResponse] = await sessionClient.detectIntent(request);

      // TODO: probably we want to handle the case where messages is null
      if (dialogflowResponse.queryResult?.fulfillmentText) {
        await channel.messages().create({
          body: dialogflowResponse.queryResult?.fulfillmentText,
          from: 'Bot',
          xTwilioWebhookEnabled: 'true',
        });
      }
      // ==============

      // If the session ended, we should unlock the channel to continue the Studio Flow
      // TODO: raise the discussion. This could be done from a Lambda that's called when the bot
      //       finishes the convo. Unfortunately, AWS only allows Lambdas there, so it may require some more work
      if (dialogflowResponse.queryResult?.diagnosticInfo?.fields?.end_conversation.boolValue) {
        const releasedChannelAttributes = {
          ...omit(channelAttributes, 'channelCapturedByBot'),
          memory: dialogflowResponse.queryResult.parameters?.fields,
        };

        // No need to delete the session here, as it's removed once end_conversation state is reached
        await Promise.all([
          // Remove channelCapturedByBot from channel attributes
          channel.update({
            attributes: JSON.stringify(releasedChannelAttributes),
          }),
          // Remove this webhook from the channel
          channel
            .webhooks()
            .get(channelAttributes.channelCapturedByBot.chatbotCallbackWebhookSid)
            .remove(),
          // Trigger a new API type Studio Flow execution once the channel is released
          client.studio.v2
            .flows(channelAttributes.channelCapturedByBot.studioFlowSid)
            .executions.create({
              from: ChannelSid,
              to: ChannelSid,
              parameters: {
                ChannelAttributes: releasedChannelAttributes,
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
