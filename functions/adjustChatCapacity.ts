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

type EnvVars = {};

export type Body = {
  workerSid?: string;
  workspaceSid?: string;
  channelSid?: string;
  workerLimit?: number;
  adjustment?: 'increase' | 'decrease';
};

const adjustChatCapacity = async (
  context: Context<EnvVars>,
  body: Required<Body>,
): Promise<{ status: number; message: string }> => {
  const client = context.getTwilioClient();

  const channel = await client.taskrouter
    .workspaces(body.workspaceSid)
    .workers(body.workerSid)
    .workerChannels(body.channelSid)
    .fetch();

  if (body.adjustment === 'increase') {
    if (channel.availableCapacityPercentage > 0)
      return { status: 412, message: 'Still have available capacity, no need to increase.' };

    if (!(channel.configuredCapacity < body.workerLimit))
      return { status: 412, message: 'Reached the max capacity.' };

    await channel.update({ capacity: channel.configuredCapacity + 1 });
    return { status: 200, message: 'Succesfully increased channel capacity' };
  }

  if (body.adjustment === 'decrease') {
    if (channel.configuredCapacity - 1 >= 1)
      await channel.update({ capacity: channel.configuredCapacity - 1 });

    // If configuredCapacity is already 1, send status 200 to avoid error on client side
    return { status: 200, message: 'Succesfully decreased channel capacity' };
  }

  return { status: 400, message: 'Invalid adjustment argument' };
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workerSid, workspaceSid, channelSid, workerLimit, adjustment } = event;

    try {
      if (workerSid === undefined) {
        return resolve(error400('workerSid'));
      }
      if (workspaceSid === undefined) {
        return resolve(error400('workspaceSid'));
      }
      if (channelSid === undefined) {
        return resolve(error400('channelSid'));
      }
      if (workerLimit === undefined) {
        return resolve(error400('workerLimit'));
      }
      if (adjustment === undefined) {
        return resolve(error400('adjustment'));
      }

      const validBody = { workerSid, workspaceSid, channelSid, workerLimit, adjustment };

      const { status, message } = await adjustChatCapacity(context, validBody);

      return resolve(send(status)({ message, status }));
    } catch (err) {
      return resolve(error500(err));
    }
  },
);
