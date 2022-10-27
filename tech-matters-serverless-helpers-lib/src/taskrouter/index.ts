import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import type { EventFields } from './eventFields';

export * from './eventTypes';
export * from './eventFields';

export type TaskrouterListener = {
  shouldHandle: (event: EventFields) => boolean;
  handleEvent: (context: Context<any>, event: EventFields, callback?: ServerlessCallback) => Promise<any>;
};
