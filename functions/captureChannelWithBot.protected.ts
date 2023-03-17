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
import type { MessageInstance } from 'twilio/lib/rest/chat/v2/service/channel/message';

type EnvVars = {
  CHAT_SERVICE_SID: string;
};

type Body = {
  channelSid: string; // (in Studio Flow, flow.channel.address) The channel to capture
  message: string; // (in Studio Flow, trigger.message.Body) The triggering message
  fromServiceUser: string; // (in Studio Flow, trigger.message.From) The service user unique name
  studioFlowSid: string; // (in Studio Flow, flow.flow_sid) The Studio Flow sid. Needed to trigger an API type execution once the channel is released.
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { channelSid, message, fromServiceUser, studioFlowSid } = event;

    if (channelSid === undefined) {
      resolve(error400('channelSid'));
      return;
    }
    if (message === undefined) {
      resolve(error400('message'));
      return;
    }
    if (fromServiceUser === undefined) {
      resolve(error400('fromServiceUser'));
      return;
    }
    if (studioFlowSid === undefined) {
      resolve(error400('studioFlowSid'));
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

    const chatbotCallbackWebhook = await channel.webhooks().create({
      type: 'webhook',
      configuration: {
        filters: ['onMessageSent'],
        method: 'POST',
        url: `https://${context.DOMAIN_NAME}/webhooks/chatbotCallback`,
      },
    });

    const updated = await channel.update({
      attributes: JSON.stringify({
        ...channelAttributes,
        fromServiceUser, // Save this in the outer scope so it's persisted for later chatbots
        // All of this can be passed as url params to the webhook instead
        channelCapturedByBot: {
          projectId: 'presurveybot-test-pmcl', // This should be passed as parameter
          languageCode: 'en-US', // This should be passed as parameter
          studioFlowSid,
          chatbotCallbackWebhookSid: chatbotCallbackWebhook.sid,
        },
      }),
    });

    const updatedChannelAttributes = JSON.parse(updated.attributes);

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
        updatedChannelAttributes.channelCapturedByBot.projectId, // projectId
        channel.sid, // sessionId
      ),
      queryInput: {
        text: {
          // The query to send to the dialogflow agent
          text: message,
          // The language used by the client (en-US)
          languageCode: updatedChannelAttributes.channelCapturedByBot.languageCode,
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

    resolve(success('Channel captured by bot =)'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
