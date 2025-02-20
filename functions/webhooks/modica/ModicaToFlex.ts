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

/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

export type EnvVars = {
  ACCOUNT_SID: string;
  CHAT_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
  MODICA_FLEX_FLOW_SID: string;
  MODICA_STUDIO_FLOW_SID: string;
  MODICA_TWILIO_MESSAGING_MODE?: 'conversations' | 'programmable-chat' | '';
};

export type Event = {
  source: string;
  destination: string;
  content: string;
  useTestApi?: boolean;
};

export const handler = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  console.log('==== ModicaToFlex handler ====');
  console.log('Received event:', event);
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { source, destination, content, useTestApi } = event;

    // TODO: Investigate if Modica provides a way to check if the payload is valid.

    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;
    const useConversations = context.MODICA_TWILIO_MESSAGING_MODE === 'conversations';

    const messageText = content;
    const channelType = channelToFlex.AseloCustomChannels.Modica;
    const subscribedExternalId = destination; // This is  the helpline short code
    const twilioNumber = `${channelType}:${subscribedExternalId}`;
    const senderExternalId = source; // This is the child phone number
    const chatFriendlyName = senderExternalId;
    const uniqueUserName = `${channelType}:${senderExternalId}`;
    const senderScreenName = 'child'; // TODO: Should we display something else here?
    const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/modica/FlexToModica?recipientId=${senderExternalId}`;
    let result: Awaited<ReturnType<typeof channelToFlex.sendConversationMessageToFlex>>;

    if (useConversations) {
      // eslint-disable-next-line no-await-in-loop
      result = await channelToFlex.sendConversationMessageToFlex(context, {
        studioFlowSid: context.MODICA_STUDIO_FLOW_SID,
        conversationFriendlyName: chatFriendlyName,
        channelType,
        uniqueUserName,
        senderScreenName,
        onMessageSentWebhookUrl,
        messageText,
        senderExternalId,
        customSubscribedExternalId: subscribedExternalId,
        useTestApi,
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      result = await channelToFlex.sendMessageToFlex(context, {
        flexFlowSid: context.MODICA_FLEX_FLOW_SID,
        chatServiceSid: context.CHAT_SERVICE_SID,
        syncServiceSid: context.SYNC_SERVICE_SID,
        channelType,
        twilioNumber,
        chatFriendlyName,
        uniqueUserName,
        senderScreenName,
        onMessageSentWebhookUrl,
        messageText,
        senderExternalId,
        subscribedExternalId,
      });
    }

    switch (result.status) {
      case 'sent':
        resolve(success(result.response));
        return;
      case 'ignored':
        resolve(success('Ignored event.'));
        return;
      default:
        throw new Error('Reached unexpected default case');
    }
  } catch (err: any) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
