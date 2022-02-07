/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  // error403,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
// import crypto from 'crypto';
import { ChannelToFlex } from '../../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  SYNC_SERVICE_SID: string;
  CHAT_SERVICE_SID: string;
  // FACEBOOK_APP_ID: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;
  INSTAGRAM_FLEX_FLOW_SID: string;
};

type InstagramMessageObject = {
  sender: {
    id: string;
  };
  recipient: {
    id: string;
  };
  timestamp: number; // message timestamp
  message: {
    mid: string;
    text: string; // the body of the message
  };
};

type InstagramMessageEntry = {
  time: number; // event timestamp
  id: string; // IGSID of the subscribed Instagram account
  messaging: [InstagramMessageObject];
};

/** Object describing a single entry and a single message.
 * We sanitize the payload in the central webhook.
 *  If we start seeing batched events this shape will not be a singleton but an array
 */
type InstagramMessageEvent = {
  object: 'instagram';
  entry: [InstagramMessageEntry];
};

export type Body = InstagramMessageEvent & {
  xHubSignature?: string; // x-hub-signature header sent from Facebook
  bodyAsString?: string; // entire payload as string (preserves the ordering to decode and compare with xHubSignature)
};

// const isValidFacebookPayload = () => true;

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  // TODO: validate signature here, if not valid resolve(error403('Unauthorized')) and return

  try {
    console.log('------ InstagramToFlex excecution ------');

    const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
    const channelToFlex = require(handlerPath) as ChannelToFlex;

    const { message, sender } = event.entry[0].messaging[0];

    const senderExternalId = sender.id;
    const subscribedExternalId = event.entry[0].id;
    const channelType = 'instagram';
    const twilioNumber = `${channelType}:${subscribedExternalId}`;
    const chatFriendlyName = `${channelType}:${senderExternalId}`;
    const uniqueUserName = `${channelType}:${senderExternalId}`;
    const senderScreenName = uniqueUserName; // TODO: see if we can use ig handle somehow
    const messageText = message.text;
    const onMessageSentWebhookUrl = `https://${context.DOMAIN_NAME}/webhooks/instagram/FlexToInstagram?recipientId=${senderExternalId}`;

    console.log(`New message from: ${senderExternalId}`);
    console.log(message.text);

    const result = await channelToFlex.sendMessageToFlex(context, {
      flexFlowSid: context.INSTAGRAM_FLEX_FLOW_SID,
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
        resolve(success(result.response));
        return;
      case 'ignored':
        resolve(success('Ignored event.'));
        return;
      default:
        throw new Error('Reached unexpected default case');
    }
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
