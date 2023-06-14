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
import { handler as updateParticipant } from '../../functions/conference/updateParticipant';

import helpers, { MockedResponse } from '../helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const mockParticipantUpdate = jest.fn();
const mockParticipantFetch = jest.fn(() => ({ update: mockParticipantUpdate }));
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
            fetch: mockParticipantFetch,
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

describe('conference/updateParticipant', () => {
  each([
    {
      when: 'conferenceSid is missing',
      body: {
        conferenceSid: undefined,
        callSid: 'callSid',
        updateAttribute: 'hold',
        updateValue: 'false',
      },
      expectedStatus: 400,
    },
    {
      when: 'callSid is missing',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: undefined,
        updateAttribute: 'hold',
        updateValue: 'false',
      },
      expectedStatus: 400,
    },
    {
      when: 'updateAttribute is missing',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updateAttribute: undefined,
        updateValue: 'false',
      },
      expectedStatus: 400,
    },
    {
      when: 'updateAttribute is an invalid value',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updateAttribute: 'invalid',
        updateValue: 'false',
      },
      expectedStatus: 400,
    },
    {
      when: 'updateValue is missing',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updateAttribute: 'hold',
        updateValue: undefined,
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

      await updateParticipant(baseContext, body, callback);
    },
  );

  each([
    {
      when: 'valid update: set "muted" true',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ muted: true }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ muted: true });
      },
    },
    {
      when: 'valid update: set "muted" false',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ muted: false }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ muted: false });
      },
    },
    {
      when: 'valid update: set "hold" true',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ hold: true }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ hold: true });
      },
    },
    {
      when: 'valid update: set "hold" false',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ hold: false }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ hold: false });
      },
    },
    {
      when: 'valid update: set "endConferenceOnExit" true',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ endConferenceOnExit: true }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ endConferenceOnExit: true });
      },
    },
    {
      when: 'valid update: set "endConferenceOnExit" false',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ endConferenceOnExit: false }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({ endConferenceOnExit: false });
      },
    },
    {
      when: 'valid update: set multiple properties',
      body: {
        conferenceSid: 'conferenceSid',
        callSid: 'callSid',
        updates: JSON.stringify({ endConferenceOnExit: false, hold: true }),
      },
      expectCallback: () => {
        expect(mockParticipantFetch).toHaveBeenCalledTimes(1);
        expect(mockParticipantUpdate).toHaveBeenCalledWith({
          endConferenceOnExit: false,
          hold: true,
        });
      },
    },
  ]).test('when $when, should return status 200', async ({ body, expectCallback }) => {
    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expectCallback();
    };

    await updateParticipant(baseContext, body, callback);
  });
});
