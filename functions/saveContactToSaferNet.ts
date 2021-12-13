import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';
import axios from 'axios';
import crypto from 'crypto';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

export type Body = {
  payload: string;
};

type EnvVars = {
  SAFERNET_ENDPOINT: string;
  SAFERNET_TOKEN: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { SAFERNET_ENDPOINT, SAFERNET_TOKEN } = context;

      if (!SAFERNET_ENDPOINT) throw new Error('SAFERNET_ENDPOINT env var not provided.');
      if (!SAFERNET_TOKEN) throw new Error('SAFERNET_TOKEN env var not provided.');

      const { payload } = event;

      const signedPayload = crypto
        .createHmac('sha256', SAFERNET_TOKEN)
        .update(encodeURIComponent(payload))
        .digest('hex');

      const saferNetResponse = await axios({
        url: SAFERNET_ENDPOINT,
        method: 'POST',
        data: JSON.parse(payload),
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signedPayload}`,
        },
      });

      if (saferNetResponse.data.success) {
        resolve(success(saferNetResponse.data.post_survey_link));
      } else {
        const errorMessage = saferNetResponse.data.error_message;

        // eslint-disable-next-line no-console
        console.error(errorMessage);
        resolve(error500(new Error(errorMessage)));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(error500(err));
    }
  },
);
