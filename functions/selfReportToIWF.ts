import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import axios, { AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  AS_DEV_IWF_API_CASE_URL: string;
  AS_DEV_IWF_REPORT_URL: string;
  AS_DEV_IWF_SECRET_KEY: string;
};

export type IWFSelfReportPayload = {
  secret_key: string;
  case_number: string;
  user_age_range: '<13' | '13-15' | '16-17';
};

export type Body = {
  user_age_range?: '<13' | '13-15' | '16-17';
  case_number?: string;
  request: { cookies: {}; headers: {} };
};

export const formData = new FormData();

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { user_age_range, case_number } = event;
      if (!user_age_range) return resolve(error400('user_age_range'));
      if (!case_number) return resolve(error400('case_number'));

      const body: IWFSelfReportPayload = {
        secret_key: context.AS_DEV_IWF_SECRET_KEY,
        case_number,
        user_age_range,
      };

      formData.append('secret_key', body.secret_key);
      formData.append('case_number', body.case_number);
      formData.append('user_age_range', body.user_age_range);

      const config: AxiosRequestConfig<any> = {
        method: 'POST',
        url: context.AS_DEV_IWF_API_CASE_URL,
        headers: {
          ...formData.getHeaders(),
        },
        data: formData,
        validateStatus: () => true,
      };

      const report = await axios(config);

      if (report.data?.result !== 'OK') return resolve(error400(report.data?.message));

      const reportUrl = `${context.AS_DEV_IWF_REPORT_URL}/t?=${report.data?.message?.access_token}`;

      const data = {
        reportUrl,
        status: report.data?.result,
      };

      return resolve(send(200)(data));
    } catch (error) {
      return resolve(error500(error as any));
    }
  },
);
