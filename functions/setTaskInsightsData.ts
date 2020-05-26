import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type Body = {
  workspaceSID?: string;
  taskSID?: string;
  conversations?: string;
  customers?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = responseWithCors();

    try {
      const body = event as Body;
      const { workspaceSID, taskSID, conversations, customers } = body;

      if (workspaceSID === undefined) {
        const err = { message: 'Error: workspaceSID parameter not provided', status: 400 };
        send(400)(err)(callback)(response);
        return;
      }

      if (taskSID === undefined) {
        const err = { message: 'Error: taskSID parameter not provided', status: 400 };
        send(400)(err)(callback)(response);
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

      send(200)(updatedTask)(callback)(response);
    } catch (err) {
      send(500)(err)(callback)(response);
    }
  },
);
