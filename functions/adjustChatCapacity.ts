import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  send,
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  workerSid?: string;
  adjustment?: 'increase' | 'decrease';
  request: { cookies: {}; headers: {} };
};

export const adjustChatCapacity = async (
  context: Context<EnvVars>,
  body: Required<Pick<Body,  'adjustment' | 'workerSid'>>,
): Promise<{ status: number; message: string }> => {
  const client = context.getTwilioClient();

  const worker = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .workers(body.workerSid)
    .fetch();

  if (!worker) return { status: 404, message: 'Could not find worker.' };

  const attributes = JSON.parse(worker.attributes);
  const maxMessageCapacity = parseInt(attributes.maxMessageCapacity, 10);

  if (!maxMessageCapacity)
    return {
      status: 409,
      message: `Worker ${body.workerSid} does not have a "maxMessageCapacity" attribute, can't adjust capacity.`,
    };

  const channels = await worker.workerChannels().list();
  const channel = channels.find((c) => c.taskChannelUniqueName === 'chat');

  if (!channel) return { status: 404, message: 'Could not find chat channel.' };

  if (body.adjustment === 'increase') {
    if (channel.availableCapacityPercentage > 0)
      return { status: 412, message: 'Still have available capacity, no need to increase.' };

    if (!(channel.configuredCapacity < maxMessageCapacity))
      return { status: 412, message: 'Reached the max capacity.' };

    await channel.update({ capacity: channel.configuredCapacity + 1 });
    return { status: 200, message: 'Successfully increased channel capacity' };
  }

  if (body.adjustment === 'decrease') {
    if (channel.configuredCapacity - 1 >= 1)
      await channel.update({ capacity: channel.configuredCapacity - 1 });

    // If configuredCapacity is already 1, send status 200 to avoid error on client side
    return { status: 200, message: 'Successfully decreased channel capacity' };
  }

  return { status: 400, message: 'Invalid adjustment argument' };
};

export type AdjustChatCapacityType = typeof adjustChatCapacity;

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workerSid, adjustment } = event;

    try {
      if (workerSid === undefined) return resolve(error400('workerSid'));
      if (adjustment === undefined) return resolve(error400('adjustment'));

      const validBody = { workerSid, adjustment };

      const { status, message } = await adjustChatCapacity(context, validBody);

      return resolve(send(status)({ message, status }));
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
