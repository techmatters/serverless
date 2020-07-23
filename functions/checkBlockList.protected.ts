import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export const handler: ServerlessFunctionSignature = (
  context: Context,
  event: any,
  callback: ServerlessCallback,
) => {
  const file = Runtime.getAssets()['/blocklist.json'].open();
  const blocklist = JSON.parse(file).numbers;
  const blocked = blocklist.some((num: string) => event.callFrom.includes(num));
  if (blocked) {
    throw new Error('User is blocked.');
  }
  callback(null, undefined);
};
