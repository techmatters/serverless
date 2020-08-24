import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { JsonObject } from 'swagger-ui-express';

export interface Event {
  Memory: string;
}

export const handler = (context: Context, event: Event, callback: ServerlessCallback) => {
  const memory = JSON.parse(event.Memory);
  const returnObj: JsonObject = { actions: [] };

  switch (memory.at) {
    case 'survey':
    case 'gender_why':
      // eslint-disable-next-line no-case-declarations
      const { gender } = memory.twilio.collected_data.collect_survey.answers;

      // Handle someone asking "why" or questioning what is meant by gender
      // Answers to the "why" question will never produce this
      if (gender.answer.toLowerCase() === 'why' && gender.error === undefined) {
        returnObj.actions.push({
          redirect: 'task://gender_why',
        });
        break;
      }

      returnObj.actions.push({
        redirect: 'task://counselor_handoff',
      });
      break;
    default:
      // If we ever get here, it's in error
      // Just handoff to counselor for now, maybe need to internally record an error
      returnObj.actions.push({
        redirect: 'task://counselor_handoff',
      });
      break;
  }
  callback(null, returnObj);
};
