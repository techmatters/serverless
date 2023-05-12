/* eslint-disable import/no-dynamic-require */
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

type EnvVars = {
  CHAT_SERVICE_SID: string;
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
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
  console.log('===== captureChannelWithBot handler =====');
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
          botId: 'C6HUSTIFBR', // This should be passed as parameter
          botAliasId: 'TSTALIASID', // This should be passed as parameter
          localeId: 'en_US', // This should be passed as parameter
          studioFlowSid,
          chatbotCallbackWebhookSid: chatbotCallbackWebhook.sid,
        },
      }),
    });

    const updatedChannelAttributes = JSON.parse(updated.attributes);

    // Cleanup task for captured channel by the bot
    const task = await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.SURVEY_WORKFLOW_SID,
        attributes: JSON.stringify({ isChatbotCaptureControl: true }),
        taskChannel: 'survey',
        timeout: 10, // 720 minutes or 12 hours
        // timeout: 45600, // 720 minutes or 12 hours
      });

    console.log('>>>', task);

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
      botId: updatedChannelAttributes.channelCapturedByBot.botId,
      botAliasId: updatedChannelAttributes.channelCapturedByBot.botAliasId,
      localeId: updatedChannelAttributes.channelCapturedByBot.localeId,
      text: message,
      sessionId: channel.sid,
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

    resolve(success('Channel captured by bot =)'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
