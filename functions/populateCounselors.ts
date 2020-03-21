import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { send } from '../utils';

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
        send(response)(400)(err)(callback);
        return;
      }

      const workspace = await context
        .getTwilioClient()
        .taskrouter.workspaces(workspaceSID)
        .fetch();

      const workers = await workspace.workers().list();

      const withAttributes = workers.map(w => {
        const attributes = JSON.parse(w.attributes);

        return {
          ...w,
          attributes,
        };
      });

      const withHelpline = withAttributes.map(w => {
        const fullName = w.attributes.full_name as string;
        const wHelpline = w.attributes.helpline as string;

        return {
          sid: w.sid,
          fullName,
          helpline: wHelpline,
        };
      });

      if (helpline) {
        const filtered = withHelpline.filter(w => w.helpline === helpline);
        const workerSummaries = filtered.map(({ fullName, sid }) => ({ fullName, sid }));

        send(response)(200)({ workerSummaries })(callback);
        return;
      }

      const workerSummaries = withHelpline.map(({ fullName, sid }) => ({ fullName, sid }));

      send(response)(200)({ workerSummaries })(callback);
    } catch (err) {
      // If there's an error, send an error response
      // Keep using the response object for CORS purposes
      send(response)(500)(err)(callback);
    }
  },
);
