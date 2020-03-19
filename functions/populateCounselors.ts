import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EventBody = {
  workspaceSID: string | undefined;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      const body = event as EventBody;
      const { workspaceSID } = body;

      if (workspaceSID === undefined) {
        throw new Error('Error: Workspace parameter not provided');
      }

      const workspace = await context
        .getTwilioClient()
        .taskrouter.workspaces(workspaceSID)
        .fetch();

      const workers = await workspace.workers().list();

      const prettyWorkers = workers.map(w => ({
        sid: w.sid,
        friendlyName: w.friendlyName,
      }));

      response.setStatusCode(200);
      response.appendHeader('Content-Type', 'application/json');
      response.setBody({ prettyWorkers });
      callback(null, response);
    } catch (err) {
      response.setStatusCode(500);
      response.appendHeader('Content-Type', 'application/json');
      response.setBody(err);
      // If there's an error, send an error response
      // Keep using the response object for CORS purposes
      callback(null, response);
    }
  },
);
