/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  SYNC_SERVICE_SID: string;
  LINE_FLEX_FLOW_SID: string;
};

type LineMessage = {
  type: 'text' | string;
  id: string;
  text: string;
};

type LineSource = {
  type: 'user' | 'group' | 'room';
  userId: string;
};

type LineEvent = {
  type: 'message' | string;
  message: LineMessage;
  timestamp: number;
  replyToken: string;
  source: LineSource;
};

export type Body = {
  destination: string;
  events: LineEvent[];
  'x-line-signature': string;
  request: any;
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { destination, events } = event;
    const { 'x-line-signature': signature } = event.request.headers;

    console.log('>> signature:', signature);

    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;

    const messageEvents = events.filter(e => e.type === 'message');

    for (let i = 0; i < messageEvents.length; i += 1) {
      const messageText = messageEvents[i].message.text;
      const channelType = channelToFlex.AseloCustomChannels.Line;
      const subscribedExternalId = destination; // This is AseloChat ID on line
      const twilioNumber = `${channelType}:${subscribedExternalId}`;
      const senderExternalId = messageEvents[i].source.userId; // This is the child ID on Line
      const chatFriendlyName = `${channelType}:${senderExternalId}`;
      const uniqueUserName = `${channelType}:${senderExternalId}`;
      const senderScreenName = 'child'; // TODO: how to fetch user Profile Name given its ID (found at 'destination' property)
      const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/line/FlexToLine?recipientId=${senderExternalId}`;

      // eslint-disable-next-line no-await-in-loop
      const result = await channelToFlex.sendMessageToFlex(context, {
        flexFlowSid: context.LINE_FLEX_FLOW_SID,
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

      switch (result.status) {
        case 'sent':
          console.log(result.response);
          return;
        case 'ignored':
          console.log('Ignored event.');
          return;
        default:
          throw new Error('Reached unexpected default case');
      }
    }

    resolve(success('Finished sending Line messages to Flex'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(err);
    resolve(error500(err));
  }
};
