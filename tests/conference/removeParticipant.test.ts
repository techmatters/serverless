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

import each from 'jest-each';
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as removeParticipant } from '../../functions/conference/removeParticipant';

import helpers, { MockedResponse } from '../helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const mockParticipantRemove = jest.fn(() => true);
const baseContext = {
  getTwilioClient: (): any => ({
    conferences: (conferenceSid: string) => {
      if (conferenceSid !== 'conferenceSid') {
        throw new Error('Kaboom');
      }

      return {
        participants: (callSid: string) => {
          if (callSid !== 'callSid') {
            throw new Error('Kaboom');
          }

          return {
            remove: mockParticipantRemove,
          };
        },
      };
    },
  }),
  TWILIO_WORKSPACE_SID: 'TWILIO_WORKSPACE_SID',
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

beforeAll(() => {
  helpers.setup({});
});
afterAll(() => {
  helpers.teardown();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('removeParticipant', () => {
  each([
    {
      when: 'conferenceSid is missing',
      body: {
        conferenceSid: undefined,
        callSid: 'callSid',
      },
      expectedStatus: 400,
    },
    {
      when: 'callSid is missing',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: undefined,
      },
      expectedStatus: 400,
    },
    {
      when: 'conferenceSid does not exists',
      body: {
        conferenceSid: 'BROKEN_CONFERENCE',
        callSid: 'callSid',
        request: { cookies: {}, headers: {} },
      },
      expectedStatus: 500,
    },
    {
      when: 'callSid does not exists',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'BROKEN_CALL',
        request: { cookies: {}, headers: {} },
      },
      expectedStatus: 500,
    },
  ]).test(
    'when $when, should return status $expectedStatus',
    async ({ body, expectedStatus, expectCallback }) => {
      const callback: ServerlessCallback = (err, result) => {
        expect(result).toBeDefined();
        const response = result as MockedResponse;
        expect(response.getStatus()).toBe(expectedStatus);
        if (expectCallback) expectCallback();
      };

      await removeParticipant(baseContext, body, callback);
    },
  );

  each([
    {
      when: 'valid conferenceSid and callSid',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
      },
      expectCallback: () => {
        expect(mockParticipantRemove).toHaveBeenCalledTimes(1);
      },
    },
  ]).test('when $when, should return status 200', async ({ body, expectCallback }) => {
    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expectCallback();
    };

    await removeParticipant(baseContext, body, callback);
  });
});
