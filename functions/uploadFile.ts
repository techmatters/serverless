import AWS, { S3, AWSError } from 'aws-sdk';
import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

export type Body = {
  fileBase64: string;
  fileName: string;
};

type EnvVars = {
  ASELO_APP_ACESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  S3_BUCKET: string;
};

const sendObject = async (s3Client: S3, uploadParams: any) => {
  return new Promise<AWS.S3.PutObjectOutput>((resolve, reject) => {
    s3Client.putObject(uploadParams, (err: AWSError, data: S3.Types.PutObjectOutput) => {
      if (err) {
        reject(err);
      }

      resolve(data);
    });
  });
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { fileBase64, fileName } = event;
      const { ASELO_APP_ACESS_KEY, ASELO_APP_SECRET_KEY, S3_BUCKET } = context;

      const fileNameAtAWS = `${new Date().getTime()}-${fileName}`;
      const content = Buffer.from(fileBase64, 'base64');

      const uploadParams = {
        Bucket: S3_BUCKET,
        Key: fileNameAtAWS,
        Body: content,
      };

      AWS.config.update({
        credentials: {
          accessKeyId: ASELO_APP_ACESS_KEY,
          secretAccessKey: ASELO_APP_SECRET_KEY,
        },
        region: 'us-east-1',
      });

      const s3Client = new AWS.S3();
      await sendObject(s3Client, uploadParams);

      resolve(success({ fileNameAtAWS }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      resolve(error500(err));
    }
  },
);
