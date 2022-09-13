import AWS, { S3, AWSError } from 'aws-sdk';
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';
import type { FunctionValidator } from './helpers/tokenValidator';

const functionValidatorPath = Runtime.getFunctions()['helpers/tokenValidator'].path;
// eslint-disable-next-line import/no-dynamic-require, global-require
const TokenValidator = require(functionValidatorPath).functionValidator as FunctionValidator;

export type Body = {
  fileName: string;
  request: { cookies: {}; headers: {} };
};

type EnvVars = {
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  S3_BUCKET: string;
  AWS_REGION: string;
};

const deleteObject = async (s3Client: S3, deleteParams: any) => {
  return new Promise<AWS.S3.DeleteObjectOutput>((resolve, reject) => {
    s3Client.deleteObject(deleteParams, (err: AWSError, data: S3.Types.DeleteObjectOutput) => {
      if (err) {
        reject(err);
      }

      resolve(data);
    });
  });
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { fileName } = event;
      const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, S3_BUCKET, AWS_REGION } = context;

      const deleteParams = {
        Bucket: S3_BUCKET,
        Key: fileName,
      };

      AWS.config.update({
        credentials: {
          accessKeyId: ASELO_APP_ACCESS_KEY,
          secretAccessKey: ASELO_APP_SECRET_KEY,
        },
        region: AWS_REGION,
      });

      const s3Client = new AWS.S3();
      await deleteObject(s3Client, deleteParams);

      resolve(success({ deletedFile: fileName }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
