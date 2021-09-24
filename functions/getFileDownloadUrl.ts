import AWS from 'aws-sdk';
import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

export type Body = {
  fileNameAtAws: string;
  fileName: string;
};

type EnvVars = {
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  S3_BUCKET: string;
  AWS_REGION: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { fileNameAtAws, fileName } = event;
      const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, S3_BUCKET, AWS_REGION } = context;

      const secondsToExpire = 30;
      const getUrlParams = {
        Bucket: S3_BUCKET,
        Key: fileNameAtAws,
        Expires: secondsToExpire,
        ResponseContentDisposition: `attachment; filename ="${fileName}"`,
      };

      AWS.config.update({
        credentials: {
          accessKeyId: ASELO_APP_ACCESS_KEY,
          secretAccessKey: ASELO_APP_SECRET_KEY,
        },
        region: AWS_REGION,
      });

      const s3Client = new AWS.S3();
      const downloadUrl = await s3Client.getSignedUrl('getObject', getUrlParams);

      resolve(success({ downloadUrl }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(error500(err));
    }
  },
);
