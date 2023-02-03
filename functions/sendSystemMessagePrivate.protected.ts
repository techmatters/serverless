import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { Body, EnvVars, SendSystemMessageModule } from './sendSystemMessage';

export const handler = (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
  console.log(' -------------------- sendSystemMessagePrivate.protected --------------------');
  const handlerPath = Runtime.getFunctions().sendSystemMessage.path;
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { sendSystemMessage } = require(handlerPath) as SendSystemMessageModule;

  sendSystemMessage(context, event, callback);
};
