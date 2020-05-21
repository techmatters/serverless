import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
  TwilioResponse,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

// TODO: Factor out into lib
const send = (statusCode: number) => (body: string | object) => (callback: ServerlessCallback) => (
  response: TwilioResponse,
) => {
  response.setStatusCode(statusCode);
  response.setBody(body);
  callback(null, response);
};

// TODO: Factor out into lib
const responseWithCors = () => {
  const response = new Twilio.Response();

  response.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });

  return response;
};

type Body = {
  workspaceSID?: string;
  taskSID?: string;
  conversationsAttributes?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = responseWithCors();

    try {
      const body = event as Body;
      const { workspaceSID, taskSID, conversationsAttributes } = body;

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
          ...(conversationsAttributes && JSON.parse(conversationsAttributes)),
          conversation_id: taskSID,
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
