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

import { Twilio } from 'twilio';
import fetch from 'node-fetch';
import { Context as rawContext } from '@twilio-labs/serverless-runtime-types/types';
import { ConversationContext } from 'twilio/lib/rest/conversations/v1/conversation';
import each from 'jest-each';
import helpers, { MockedResponse, RecursivePartial } from '../../helpers';
import {
  Body as rawBody,
  EnvVars,
  handler,
} from '../../../functions/webhooks/modica/FlexToModica.protected';

/**
 * Temporary workaround to assume it's a conversation webhook event.
 * Because currently it can be bothe conversation or programmable chat webhook event.
 */
type Body = rawBody & { ConversationSid: string; Author: string };

type Context = rawContext & EnvVars;

jest.mock('node-fetch');
const { Response, Headers } = jest.requireActual('node-fetch');

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

const CH_MODICA_CONVERSATION_SID = 'CH_MODICA_CONVERSATION_SID';

let baseContext: Context;

let baseEvent: Body;
let baseTwilioClient: RecursivePartial<Twilio> = {};
let conversationContext: RecursivePartial<ConversationContext>;
let base64Credentials: string;

const BASELINE_DATE = new Date('2000-01-01T00:00:00Z');

/**
 * There's a sanitization that prefixes '+' to the recipientId if it doesn't have it.
 * That's why we're setting the recipientId prefixed with '+' here.
 */
const MODICA_RECIPIENT_ID = '+modica_recipient_id';

beforeAll(() => {
  conversationContext = {
    fetch: async () => ({
      attributes: '{}',
      sid: CH_MODICA_CONVERSATION_SID,
    }),
    messages: {
      create: jest.fn().mockImplementation(async () => ({ response: 'property' })),
    },
  };

  baseTwilioClient = {
    conversations: {
      v1: {
        conversations: {
          get: () => conversationContext,
        },
      },
    },
  };
  baseContext = {
    DOMAIN_NAME: 'serverless',
    ACCOUNT_SID: 'ACCOUNT_SID',
    PATH: '',
    SERVICE_SID: undefined,
    ENVIRONMENT_SID: undefined,
    MODICA_APP_NAME: 'MODICA_APP_NAME',
    MODICA_APP_PASSWORD: 'MODICA_APP_PASSWORD',
    CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
    getTwilioClient: jest.fn().mockReturnValue(baseTwilioClient),
  } as Context;

  const runtime = new helpers.MockRuntime(baseContext);
  // eslint-disable-next-line no-underscore-dangle
  runtime._addFunction(
    'helpers/customChannels/flexToCustomChannel',
    'functions/helpers/customChannels/flexToCustomChannel.private',
  );
  helpers.setup({}, runtime);
});

afterAll(() => {
  helpers.teardown();
});

beforeEach(() => {
  jest.clearAllMocks();

  base64Credentials = Buffer.from(
    `${baseContext.MODICA_APP_NAME}:${baseContext.MODICA_APP_PASSWORD}`,
  ).toString('base64');

  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Basic ${base64Credentials}`,
  });

  const ResponseInit = {
    status: 200,
    statusText: 'ok',
    headers,
  };

  const response = new Response(JSON.stringify({ data: {} }), ResponseInit);

  mockFetch.mockResolvedValue(response);

  conversationContext = {
    fetch: async () => ({
      attributes: JSON.stringify({
        participantSid: 'flex_participant_id',
      }),
      sid: CH_MODICA_CONVERSATION_SID,
    }),
    participants: {
      list: jest.fn().mockResolvedValue([
        {
          sid: 'not_flex_participant_id',
          dateCreated: new Date(BASELINE_DATE.valueOf() + 1000).toISOString(),
        },
        { sid: 'flex_participant_id', dateCreated: BASELINE_DATE.toISOString() },
      ]),
    },
  };

  baseTwilioClient = {
    conversations: {
      conversations: {
        get: () => conversationContext,
      },
    },
  };

  const partialEvent: RecursivePartial<Body> = {
    ConversationSid: CH_MODICA_CONVERSATION_SID,
    Body: 'Flex to Modica text',
    Author: 'modica_participant_id',
    EventType: 'onMessageAdded',
    Source: 'API',
    ParticipantSid: 'modica_participant_id',
    recipientId: MODICA_RECIPIENT_ID,
  };
  baseEvent = partialEvent as Body;
});

const testCases: readonly (keyof Body)[] = [
  'ConversationSid',
  'Body',
  'Author',
  'EventType',
  'Source',
] as const;

const verifyModicaMessageRequestSent = (response: MockedResponse) => {
  expect(mockFetch).toHaveBeenCalledWith('https://api.modicagroup.com/rest/gateway/messages', {
    method: 'POST',
    body: JSON.stringify({
      destination: MODICA_RECIPIENT_ID,
      content: 'Flex to Modica text',
    }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${base64Credentials}`,
    },
  });
  const { ok, resultCode, body } = response.getBody();
  expect(ok).toBe(true);
  expect(resultCode).toBe(200);
  expect(body).toStrictEqual({ data: {} });
  expect(response.getStatus()).toBe(200);
};

each(testCases).test('Missing required properties in event - 400', async (prop: keyof Body) => {
  const callback = jest.fn();
  const { [prop]: removed, ...eventWithoutConversationSid } = baseEvent;
  await handler(baseContext, eventWithoutConversationSid as Body, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(400);
});

test('API Source and event ParticipantSid same as sid of first participant added to convo - 200', async () => {
  console.log('>> Start');
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, ParticipantSid: 'flex_participant_id' }, callback);
  console.log('>> ');
  console.log(JSON.stringify(callback.mock.calls[0]));
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});

test('API Source and event ParticipantSid same as sid of first participant added to convo - ignored (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, ParticipantSid: 'flex_participant_id' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});

test('API Source and event ParticipantSid different to sid of first participant added to convo - sent (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyModicaMessageRequestSent(response);
  expect(response.getStatus()).toBe(200);
});

test('SDK Source and event ParticipantSid same as sid of first participant added to convo - sent (200)', async () => {
  const callback = jest.fn();
  await handler(
    baseContext,
    { ...baseEvent, Source: 'SDK', ParticipantSid: 'flex_participant_id' },
    callback,
  );
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyModicaMessageRequestSent(response);
});

test('SDK Source and event ParticipantSid different to sid of first participant added to convo - sent (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, Source: 'SDK' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyModicaMessageRequestSent(response);
  expect(response.getStatus()).toBe(200);
});

test('Source not or SDK or API - ignored (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, Source: 'Something else' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});

test('EventType not onMessageAdded- ignored (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, EventType: 'not onMessageAdded' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});
