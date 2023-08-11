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
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  handler as getExternalRecordingS3Location,
  Body,
} from '../functions/getExternalRecordingS3Location';
import helpers, { MockedResponse } from './helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const baseContext = {
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
  ACCOUNT_SID: 'AC1234567890',
  S3_BUCKET: 'mock-s3-bucket',
};

const getBaseContext = (mockRecordings: Record<string, string>[] = []) => {
  const mockTwilioClient = {
    recordings: {
      list: async () => mockRecordings,
    },
  };

  return {
    ...baseContext,
    getTwilioClient: (): any => mockTwilioClient,
  };
};

describe('getExternalRecordingS3Location', () => {
  beforeAll(() => {
    helpers.setup({});
  });

  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400 when callSid missing', async () => {
    // @ts-ignore
    const event: Body = { callSid: undefined };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await getExternalRecordingS3Location(getBaseContext(), event, callback);
  });

  test('Should return 404 when no recording found', async () => {
    const event: Body = { callSid: 'CA123', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(404);
    };

    await getExternalRecordingS3Location(getBaseContext(), event, callback);
  });

  test('Should return 409 when more than one recording found', async () => {
    const mockRecordings = [{ sid: 'RE123' }, { sid: 'RE456' }];
    const event: Body = { callSid: 'CA123', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(409);
    };

    await getExternalRecordingS3Location(getBaseContext(mockRecordings), event, callback);
  });

  test('Should return 200 when recording found', async () => {
    const mockRecordings = [{ sid: 'RE123' }];
    const event: Body = { callSid: 'CA123', request: { cookies: {}, headers: {} } };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toEqual({
        recordingSid: 'RE123',
        key: 'voice-recordings/AC1234567890/RE123',
        bucket: 'mock-s3-bucket',
      });
    };

    await getExternalRecordingS3Location(getBaseContext(mockRecordings), event, callback);
  });
});
