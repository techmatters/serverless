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

const https = require('https');

type EnvVars = {
  IWF_API_CASE_URL: string;
  IWF_REPORT_URL: string;
  IWF_SECRET_KEY: string;
  IWF_REPORT_SELF_SIGNED: string;
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
        secret_key: context.IWF_SECRET_KEY,
        case_number,
        user_age_range,
      };

      formData.append('secret_key', body.secret_key);
      formData.append('case_number', body.case_number);
      formData.append('user_age_range', body.user_age_range);

      const config: AxiosRequestConfig = {
        method: 'POST',
        url: context.IWF_API_CASE_URL,
        headers: {
          ...formData.getHeaders(),
        },
        data: formData,
        validateStatus: () => true,
      };

      if (
        context.IWF_REPORT_SELF_SIGNED &&
        context.IWF_REPORT_SELF_SIGNED.toLowerCase() === 'true'
      ) {
        config.httpsAgent = new https.Agent({
          // This is a TEMPORARY workaround to allow testing whilst the IWF test server users a self signed TLS cert
          // Do not deploy to production
          rejectUnauthorized: false,
        });
      }

      const report = await axios(config);

      if (report.data?.result !== 'OK') return resolve(error400(report.data?.message));

      const reportUrl = `${context.IWF_REPORT_URL}/t?=${report.data?.message?.access_token}`;

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
