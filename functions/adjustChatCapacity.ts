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
  success,
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

const adjustChatCapacity = async (context: Context<EnvVars>, body: Required<Body>) => {
  const client = context.getTwilioClient();

  const channel = await client.taskrouter
    .workspaces(body.workspaceSid)
    .workers(body.workerSid)
    .workerChannels(body.channelSid)
    .fetch();

  if (body.adjustment === 'increase') {
    if (channel.availableCapacityPercentage === 0 && channel.configuredCapacity < body.workerLimit)
      await channel.update({ capacity: channel.configuredCapacity + 1 });
  }

  if (body.adjustment === 'decrease') {
    if (channel.configuredCapacity - 1 >= 1)
      await channel.update({ capacity: channel.configuredCapacity - 1 });
  }
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

      await adjustChatCapacity(context, validBody);

      return resolve(
        success(`Chat channel capicity adjusted with "${adjustment}" for worker ${workerSid}`),
      );
    } catch (err) {
      return resolve(error500(err));
    }
  },
);
