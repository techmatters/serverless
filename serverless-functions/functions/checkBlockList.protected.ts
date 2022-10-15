import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';

export interface Event {
  callFrom: string;
}

export const handler = (context: Context, event: Event, callback: ServerlessCallback) => {
  const file = Runtime.getAssets()['/blocklist.json'];
  const blocklist = file ? JSON.parse(file.open()).numbers : [];
  const blocked = blocklist.some((num: string) => event.callFrom.includes(num));
  if (blocked) {
    throw new Error('User is blocked.');
  }
  callback(null, undefined);
};
