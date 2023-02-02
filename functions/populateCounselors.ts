/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

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
