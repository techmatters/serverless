import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import type { FunctionValidator } from './helpers/tokenValidator';

const functionValidatorPath = Runtime.getFunctions()['helpers/tokenValidator'].path;
// eslint-disable-next-line import/no-dynamic-require, global-require
const TokenValidator = require(functionValidatorPath).functionValidator as FunctionValidator;

export type Body = {
  workspaceSID?: string;
  helpline?: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { workspaceSID, helpline } = event;

    try {
      if (workspaceSID === undefined) {
        resolve(error400('WorkspaceSID'));
        return;
      }

      const workspace = await context.getTwilioClient().taskrouter.workspaces(workspaceSID).fetch();

      const workers = await workspace.workers().list();

      const withAttributes = workers.map((w) => {
        const attributes = JSON.parse(w.attributes);

        return {
          ...w,
          attributes,
        };
      });

      const withHelpline = withAttributes.map((w) => {
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
          (w) => w.helpline === helpline || w.helpline === '' || w.helpline === undefined,
        );
        const workerSummaries = filtered.map(({ fullName, sid }) => ({ fullName, sid }));

        resolve(success({ workerSummaries }));
        return;
      }

      const workerSummaries = withHelpline.map(({ fullName, sid }) => ({ fullName, sid }));

      resolve(success({ workerSummaries }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
