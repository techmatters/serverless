/**
 * In order to make post surveys work, we need to disable the Channel Janitor (see https://www.twilio.com/docs/flex/developer/messaging/manage-flows#channel-janitor).
 * However, once the post survey is finished we want to mimic this feature to clear the channel and the proxy session, to enable future conversations from the same customer
 * Ths file exposes functionalities to achieve this. postSurveyJanitor will:
 * - Label the chat channel as INACTIVE.
 * - Delete the associated proxy session if there is one.
 */

// eslint-disable-next-line prettier/prettier
import type { Context } from '@twilio-labs/serverless-runtime-types/types';

export interface Event {
  channelSid: string;
  channelType: 'chat';
}

type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const deleteProxySession = async (context: Context<EnvVars>, proxySession: string) => {
  try {
    const client = context.getTwilioClient();
    const ps = await client.proxy
      .services(context.FLEX_PROXY_SERVICE_SID)
      .sessions(proxySession)
      .fetch();

    if (!ps) {
      // eslint-disable-next-line no-console
      console.warn(`Tried to remove proxy session ${proxySession} but couldn't find it.`);
      return false;
    }

    const removed = await ps.remove();

    return removed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('deleteProxySession error: ', err);
    return false;
  }
};

const deactivateChannel = async (
  context: Context<EnvVars>,
  serviceSid: string,
  channelSid: string,
) => {
  const client = context.getTwilioClient();

  const channel = await client.chat.services(serviceSid).channels(channelSid).fetch();

  const attributes = JSON.parse(channel.attributes);

  if (attributes.proxySession) {
    await deleteProxySession(context, attributes.proxySession);
  }

  const newAttributes = { ...attributes, status: 'INACTIVE' };
  const updated = await channel.update({
    attributes: JSON.stringify(newAttributes),
    xTwilioWebhookEnabled: 'true',
  });

  return updated;
};

export const postSurveyJanitor = async (context: Context<EnvVars>, event: Event) => {
  console.log('-------- postSurveyJanitor execution --------');

  if (event.channelType === 'chat') {
    await deactivateChannel(context, context.CHAT_SERVICE_SID, event.channelSid);

    return { message: `Deactivation successful for channel ${event.channelSid}` };
  }

  return { message: 'Ignored event' };
};

export type PostSurveyJanitor = typeof postSurveyJanitor;
