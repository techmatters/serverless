import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
import {
  bindResolve,
  error400,
  error500,
  responseWithCors,
  send,
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  IWF_API_USERNAME: string;
  IWF_API_PASSWORD: string;
  IWF_API_URL: string;
  IWF_API_ENVIRONMENT?: string;
  IWF_API_COUNTRY_CODE?: string;
  IWF_API_CHANNEL_ID?: string;
};

export type IWFReportPayload = {
  Reporting_Type: 'R'; // "R" for report
  Live_Report: 'L' | 'T'; // "L" for Live, "T" for test
  Media_Type_ID: 1; // 1 for a URL report
  Report_Channel_ID: number; // 51 for online report
  Origin_ID: 5; // 5 for public report
  Submission_Type_ID: 1; // 1 for online report
  Reported_Category_ID: 2; // 2 for suspected child sexual abuse report (remit child)
  Reported_URL: string; // Max 1000 characters
  Reporter_Anonymous: 'Y' | 'N'; // Is the report anonymous or not
  Reporter_First_Name: string | null; // Max 50 characters
  Reporter_Last_Name: string | null; // Max 50 characters
  Reporter_Email_ID: string | null; // Max 100 characters
  Reporter_Country_ID: number | null; // Reporter's country (Helpline specific)
  Reporter_Description: string | null; // Max 500 characters
};

export type Event = {
  Reported_URL?: string;
  Reporter_Anonymous?: string;
  Reporter_First_Name?: string;
  Reporter_Last_Name?: string;
  Reporter_Email_ID?: string;
  Reporter_Description?: string;
  request: { cookies: {}; headers: {} };
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = TokenValidator(
  async (
    context: Context<EnvVars>,
    event: Required<
      Pick<
        Event,
        | 'Reported_URL'
        | 'Reporter_Anonymous'
        | 'Reporter_Description'
        | 'Reporter_Email_ID'
        | 'Reporter_First_Name'
        | 'Reporter_Last_Name'
      >
    >,
    callback: ServerlessCallback,
  ) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    try {
      const {
        Reported_URL,
        Reporter_Anonymous,
        Reporter_First_Name,
        Reporter_Last_Name,
        Reporter_Email_ID,
        Reporter_Description,
      } = event;

      if (!Reported_URL) return resolve(error400('Reported_URL'));
      if (!Reporter_Anonymous || (Reporter_Anonymous !== 'Y' && Reporter_Anonymous !== 'N'))
        return resolve(error400('Reporter_Anonymous'));

      const liveReportFlag = context.IWF_API_ENVIRONMENT === 'L' ? 'L' : 'T';
      const countryID = context.IWF_API_COUNTRY_CODE
        ? parseInt(context.IWF_API_COUNTRY_CODE, 10)
        : null;

      const channelID = context.IWF_API_CHANNEL_ID ? parseInt(context.IWF_API_CHANNEL_ID, 10) : 51;

      const body: Required<
        Pick<
          IWFReportPayload,
          | 'Reporting_Type'
          | 'Live_Report'
          | 'Media_Type_ID'
          | 'Report_Channel_ID'
          | 'Origin_ID'
          | 'Submission_Type_ID'
          | 'Reported_Category_ID'
          | 'Reported_URL'
          | 'Reporter_Anonymous'
          | 'Reporter_First_Name'
          | 'Reporter_Last_Name'
          | 'Reporter_Email_ID'
          | 'Reporter_Country_ID'
          | 'Reporter_Description'
        >
      > = {
        Reporting_Type: 'R',
        Live_Report: liveReportFlag,
        Media_Type_ID: 1,
        Report_Channel_ID: channelID,
        Origin_ID: 5,
        Submission_Type_ID: 1,
        Reported_Category_ID: 2,
        Reported_URL,
        Reporter_Anonymous,
        Reporter_First_Name: Reporter_First_Name || null,
        Reporter_Last_Name: Reporter_Last_Name || null,
        Reporter_Email_ID: Reporter_Email_ID || null,
        Reporter_Description: Reporter_Description || null,
        Reporter_Country_ID: countryID,
      };

      const hash = Buffer.from(`${context.IWF_API_USERNAME}:${context.IWF_API_PASSWORD}`).toString(
        'base64',
      );

      const report = await axios({
        url: context.IWF_API_URL,
        method: 'POST',
        data: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${hash}`,
        },
        validateStatus: () => true, // always resolve the promise to redirect the response in case of response out of 2xx range
      });

      return resolve(send(report.status)(report.data));
    } catch (err) {
      return resolve(error500(err as any));
    }
  },
);
