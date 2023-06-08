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
import { handler as addParticipant, Body } from '../../functions/conference/addParticipant';

import helpers, { MockedResponse } from '../helpers';

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const mockParticipantCreate = jest.fn((participant) => participant);
const baseContext = {
  getTwilioClient: (): any => ({
    conferences: (conferenceSid: string) => {
      if (conferenceSid === 'BROKEN_CONFERENCE') {
        throw new Error('Kaboom');
      }

      return {
        participants: {
          create: mockParticipantCreate,
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

describe('conference/addParticipant', () => {
  each([
    {
      when: 'conferenceSid is missing',
      body: {
        conferenceSid: undefined,
        from: 'from',
        to: 'to',
        label: 'label',
      },
    },
    {
      when: 'from is missing',
      body: {
        conferenceSid: 'conferenceSid',
        from: undefined,
        to: 'to',
        label: 'label',
      },
    },
    {
      when: 'to is missing',
      body: {
        conferenceSid: 'conferenceSid',
        from: 'from',
        to: undefined,
        label: 'label',
      },
    },
  ]).test('when $when, should return status 400', async ({ body }) => {
    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
    };

    await addParticipant(baseContext, body, callback);
  });

  test('when something goes wrong internally, should return status 500', async () => {
    const body: Body = {
      conferenceSid: 'BROKEN_CONFERENCE',
      from: 'from',
      to: 'to',
      label: 'label',
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
    };

    await addParticipant(baseContext, body, callback);
  });

  each([
    {
      when: 'label is present',
      body: {
        conferenceSid: 'conferenceSid',
        from: 'from',
        to: 'to',
        label: 'label',
      },
      expectCallback: () => {
        expect(mockParticipantCreate).toHaveBeenCalledWith({
          from: 'from',
          to: 'to',
          earlyMedia: true,
          endConferenceOnExit: false,
          label: 'label',
        });
      },
    },
    {
      when: 'label is absent, use placeholder',
      body: {
        conferenceSid: 'conferenceSid',
        from: 'from',
        to: 'to',
      },
      expectCallback: () => {
        expect(mockParticipantCreate).toHaveBeenCalledWith({
          from: 'from',
          to: 'to',
          earlyMedia: true,
          endConferenceOnExit: false,
          label: 'external party',
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

    await addParticipant(baseContext, body, callback);
  });
});
