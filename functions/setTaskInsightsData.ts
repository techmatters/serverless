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
} from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

export type Body = {
  workspaceSID?: string;
  taskSID?: string;
  conversations?: string;
  customers?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workspaceSID, taskSID, conversations, customers } = event;

    try {
      if (workspaceSID === undefined) {
        resolve(error400('workspaceSID'));
        return;
      }
      if (taskSID === undefined) {
        resolve(error400('taskSID'));
        return;
      }

      const taskToBeUpdated = await context
        .getTwilioClient()
        .taskrouter.workspaces(workspaceSID)
        .tasks(taskSID)
        .fetch();

      const previousAttributes = JSON.parse(taskToBeUpdated.attributes);
      const newAttributes = {
        ...previousAttributes,
        conversations: {
          ...previousAttributes.conversations,
          ...(conversations && JSON.parse(conversations)),
          conversation_id: taskSID,
        },
        customers: {
          ...previousAttributes.customers,
          ...(customers && JSON.parse(customers)),
        },
      };

      const updatedTask = await context
        .getTwilioClient()
        .taskrouter.workspaces(workspaceSID)
        .tasks(taskSID)
        .update({ attributes: JSON.stringify(newAttributes) });

      resolve(success(updatedTask));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
