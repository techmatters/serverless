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
  workspaceSID: string | undefined;
  helpline: string | undefined;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: {}, callback: ServerlessCallback) => {
    const response = responseWithCors();

    try {
      const body = event as Body;
      const { workspaceSID, helpline } = body;

      if (workspaceSID === undefined) {
        const err = { message: 'Error: WorkspaceSID parameter not provided', status: 400 };
        send(400)(err)(callback)(response);
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
        const filtered = withHelpline.filter(
          w => w.helpline === helpline || w.helpline === '' || w.helpline === undefined,
        );
        const workerSummaries = filtered.map(({ fullName, sid }) => ({ fullName, sid }));

        send(200)({ workerSummaries })(callback)(response);
        return;
      }

      const workerSummaries = withHelpline.map(({ fullName, sid }) => ({ fullName, sid }));

      send(200)({ workerSummaries })(callback)(response);
    } catch (err) {
      send(500)(err)(callback)(response);
    }
  },
);
