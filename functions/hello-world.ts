import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export const handler: ServerlessFunctionSignature = (
  context: Context,
  event: {},
  callback: ServerlessCallback,
) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say('Hello World!');
  callback(null, twiml);
};
