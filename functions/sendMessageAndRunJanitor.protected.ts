import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
} from '@tech-matters/serverless-helpers';
import { Body, EnvVars as SendSystemEnv, SendSystemMessageModule } from './sendSystemMessage';
import { ChatChannelJanitor, EnvVars as JanitorEnv } from './helpers/chatChannelJanitor.private';

type EnvVars = SendSystemEnv & JanitorEnv;

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log(' -------------------- sendSystemMessagePrivate.protected --------------------');

  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { channelSid } = event;

    if (channelSid === undefined) {
      resolve(error400('ChannelSid parameter is missing'));
      return;
    }

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { sendSystemMessage } = require(Runtime.getFunctions().sendSystemMessage
      .path) as SendSystemMessageModule;

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const chatChannelJanitor = require(Runtime.getFunctions()['helpers/chatChannelJanitor'].path)
      .chatChannelJanitor as ChatChannelJanitor;

    // Send message
    const result = await sendSystemMessage(context, event);

    // Deactivate channel and proxy
    await chatChannelJanitor(context, { channelSid });

    resolve(send(result.status)(result.message));
  } catch (err: any) {
    resolve(error500(err));
  }
};
