import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import { v4 } from 'uuid';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  IWF_API_CASE_URL: string;
  IWF_REPORT_URL: string;
  IWF_SECRET_KEY: string;
};

export type IWFSelfReportPayload = {
  secret_key: string;
  case_number: string;
  user_age_range: '<13' | '13-15' | '16-17';
};

export type Body = {
  user_age_range: '<13' | '13-15' | '16-17';
  request: { cookies: {}; headers: {} };
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { user_age_range } = event;
      if (!user_age_range) return resolve(error400('user_age_range'));

      const body: IWFSelfReportPayload = {
        secret_key: context.IWF_SECRET_KEY,
        case_number: v4(),
        user_age_range,
      };

      const report = await axios({
        url: context.IWF_API_CASE_URL,
        method: 'POST',
        data: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      });

      if (report.data?.result !== 'OK') return resolve(error400(report.data?.message));

      const reportUrl = `${context.IWF_REPORT_URL}/t?=${report.data?.message?.access_token}`;
      return resolve(send(report.data?.result)(reportUrl));
    } catch (error) {
      return resolve(error500(error as any));
    }
  },
);
