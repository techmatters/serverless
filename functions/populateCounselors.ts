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
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

export type Body = {
  workspaceSID?: string;
  helpline?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workspaceSID, helpline } = event;

    try {
      if (workspaceSID === undefined) {
        resolve(error400('WorkspaceSID'));
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

        resolve(success({ workerSummaries }));
        return;
      }

      const workerSummaries = withHelpline.map(({ fullName, sid }) => ({ fullName, sid }));

      resolve(success({ workerSummaries }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(error500(err));
    }
  },
);
