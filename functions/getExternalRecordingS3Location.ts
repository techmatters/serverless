import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  send,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  ACCOUNT_SID: string;
  S3_BUCKET: string;
};

export type Body = {
  callSid: string;
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    const { ACCOUNT_SID: accountSid, S3_BUCKET: bucket } = context;

    try {
      const { callSid } = event;
      if (callSid === undefined) {
        resolve(error400('callSid'));
        return;
      }

      const client = context.getTwilioClient();
      const recordings = await client.recordings.list({ callSid, limit: 20 });
      if (recordings.length === 0) {
        resolve(send(404)({ status: 404, message: 'No recording found' }));
        return;
      }
      if (recordings.length > 1) {
        resolve(send(409)({ status: 409, message: 'More than one recording found' }));
        return;
      }

      const recordingSid = recordings[0].sid;
      const key = `voice-recordings/${accountSid}/${recordingSid}`;
      resolve(success({ recordingSid, key, bucket }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
