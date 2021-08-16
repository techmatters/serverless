import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export interface Event {
  Channel: string;
  CurrentTask: string;
  Memory: string;
  UserIdentifier: string;
}

type EnvVars = {
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
  ServiceSid: string,
  ChannelSid: string,
) => {
  const client = context.getTwilioClient();

  const channel = await client.chat
    .services(ServiceSid)
    .channels(ChannelSid)
    .fetch();

  const attributes = JSON.parse(channel.attributes);
  const newAttributes = { ...attributes, status: 'INACTIVE' };

  const updated = await channel.update({
    attributes: JSON.stringify(newAttributes),
    xTwilioWebhookEnabled: 'true',
  });

  if (attributes.proxySession) {
    await deleteProxySession(context, attributes.proxySession);
  }

  return updated;
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  Object.entries(event).forEach(([k, v]) => {
    console.log(k, JSON.stringify(v));
  });
  try {
    const memory = JSON.parse(event.Memory);
    const { ServiceSid, ChannelSid } = memory.twilio.chat;

    const client = context.getTwilioClient();

    if (event.Channel === 'chat' && event.CurrentTask === 'complete_post_survey') {
      const ws = await client.chat
        .services(ServiceSid)
        .channels(ChannelSid)
        .webhooks.list();

      await Promise.all(ws.map(w => w.remove())); // Remove the bot from the channel

      await client.chat
        .services(ServiceSid)
        .channels(ChannelSid)
        .messages.create({
          body: 'Thanks!!',
          xTwilioWebhookEnabled: 'true',
        });

      await deactivateChannel(context, ServiceSid, ChannelSid);
    }

    const actions: never[] = []; // Empty actions array so bot finishes it's execution
    const returnObj = { actions };

    callback(null, returnObj);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    callback(null, { actions: [] });
  }
};
