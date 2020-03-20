import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EventBody = {
  workspaceSID: string | undefined;
  helpline: string | undefined;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    try {
      const body = event as EventBody;
      const { workspaceSID, helpline } = body;

      if (workspaceSID === undefined) {
        const err = { message: 'Error: WorkspaceSID parameter not provided', status: 400 };
        response.setStatusCode(400);
        response.setBody(err);
        callback(null, response);
        return;
      }

      const workspace = await context
        .getTwilioClient()
        .taskrouter.workspaces(workspaceSID)
        .fetch();

      const workers = await workspace.workers().list();

      const detailedWorkers = workers.map(w => {
        const attributes = JSON.parse(w.attributes);

        return {
          ...w,
          attributes,
        };
      });

      const workerSummaries = detailedWorkers.map(w => {
        const fullName = w.attributes.full_name;
        const wHelpline = w.attributes.helpline;

        return {
          sid: w.sid,
          fullName,
          helpline: wHelpline,
        };
      });

      if (helpline) {
        const withFilter = workerSummaries.filter(w => w.helpline === helpline);
        response.setStatusCode(200);
        response.setBody({ workerSummaries: withFilter });
        callback(null, response);
        return;
      }

      response.setStatusCode(200);
      response.setBody({ workerSummaries });
      callback(null, response);
    } catch (err) {
      response.setStatusCode(500);
      response.setBody(err);
      // If there's an error, send an error response
      // Keep using the response object for CORS purposes
      callback(null, response);
    }
  },
);
