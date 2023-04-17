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

import AWS, { S3, AWSError } from 'aws-sdk';
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';

export type Body = {
  fileName: string;
  request: { cookies: {}; headers: {} };
};

type EnvVars = {
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_ENDPOINT: string;
  AWS_REGION: string;
};

const deleteObject = async (s3Client: S3, deleteParams: any) =>
  new Promise<AWS.S3.DeleteObjectOutput>((resolve, reject) => {
    s3Client.deleteObject(deleteParams, (err: AWSError, data: S3.Types.DeleteObjectOutput) => {
      if (err) {
        reject(err);
      }

      resolve(data);
    });
  });

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { fileName } = event;
      const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, S3_BUCKET, S3_ENDPOINT, AWS_REGION } =
        context;

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

      const s3Client = new AWS.S3(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {});
      await deleteObject(s3Client, deleteParams);

      resolve(success({ deletedFile: fileName }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
