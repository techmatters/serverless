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

import AWS from 'aws-sdk';
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
  fileNameAtAws: string;
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

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { fileNameAtAws, fileName } = event;
      const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, S3_BUCKET, S3_ENDPOINT, AWS_REGION } =
        context;

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

      const s3Client = new AWS.S3(
        S3_ENDPOINT
          ? { endpoint: S3_ENDPOINT, s3ForcePathStyle: true, signatureVersion: 'v4' }
          : {},
      );

      const downloadUrl = await s3Client.getSignedUrl('getObject', getUrlParams);

      resolve(success({ downloadUrl }));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
