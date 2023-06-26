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
import { LexClient } from './helpers/lexClient.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
};

export type Body = {
  channelSid: string; // (in Studio Flow, flow.channel.address) The channel to capture
  message: string; // (in Studio Flow, trigger.message.Body) The triggering message
  fromServiceUser: string; // (in Studio Flow, trigger.message.From) The service user unique name
  studioFlowSid: string; // (in Studio Flow, flow.flow_sid) The Studio Flow sid. Needed to trigger an API type execution once the channel is released.
  botName: string;
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
    const { channelSid, message, fromServiceUser, studioFlowSid, botName } = event;

    if (!channelSid) {
      resolve(error400('channelSid'));
      return;
    }
    if (!message) {
      resolve(error400('message'));
      return;
    }
    if (!fromServiceUser) {
      resolve(error400('fromServiceUser'));
      return;
    }
    if (!studioFlowSid) {
      resolve(error400('studioFlowSid'));
      return;
    }
    if (!botName) {
      resolve(error400('botName'));
      return;
    }

    const channel = await context
      .getTwilioClient()
      .chat.v2.services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .fetch();

    const channelAttributes = JSON.parse(channel.attributes);

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
          botName,
          botAlias: 'latest', // assume we always use the latest published version
          studioFlowSid,
          chatbotCallbackWebhookSid: chatbotCallbackWebhook.sid,
        },
      }),
    });

    const updatedChannelAttributes = JSON.parse(updated.attributes);

    // Cleanup task for captured channel by the bot
    await context
      .getTwilioClient()
      .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.SURVEY_WORKFLOW_SID,
        attributes: JSON.stringify({
          isChatCaptureControl: true,
          channelSid,
        }),
        taskChannel: 'survey',
        timeout: 45600, // 720 minutes or 12 hours
      });

    const handlerPath = Runtime.getFunctions()['helpers/lexClient'].path;
    const lexClient = require(handlerPath) as LexClient;

    const lexResponse = await lexClient.postText(context, {
      botName: updatedChannelAttributes.channelCapturedByBot.botName,
      botAlias: updatedChannelAttributes.channelCapturedByBot.botAlias,
      inputText: message,
      userId: channel.sid,
    });

    await channel.messages().create({
      body: lexResponse.message,
      from: 'Bot',
      xTwilioWebhookEnabled: 'true',
    });

    resolve(success('Channel captured by bot =)'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
