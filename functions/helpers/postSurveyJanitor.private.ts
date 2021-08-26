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

  const channel = await client.chat
    .services(serviceSid)
    .channels(channelSid)
    .fetch();

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

export const postSurveyJanitor = async (
  context: Context<EnvVars>,
  event: Event
) => {
  console.log('-------- postSurveyJanitor execution --------');

  // const client = context.getTwilioClient();

  if (event.channelType === 'chat') {
    // const ws = await client.chat
    //   .services(context.CHAT_SERVICE_SID)
    //   .channels(event.channelSid)
    //   .webhooks.list();

    // await Promise.all(ws.map(w => w.remove())); // Remove the bot from the channel

    // await client.chat
    //   .services(ServiceSid)
    //   .channels(ChannelSid)
    //   .messages.create({
    //     body: 'Thanks!!',
    //     xTwilioWebhookEnabled: 'true',
    //   });

    await deactivateChannel(context, context.CHAT_SERVICE_SID, event.channelSid);

    return { message: `Deactivation successful for channel ${event.channelSid}` };
  }

  return { message: 'Ignored event' };
};

export type PostSurveyJanitor = typeof postSurveyJanitor;
