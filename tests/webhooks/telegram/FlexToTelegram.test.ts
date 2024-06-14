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
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { ConversationContext } from 'twilio/lib/rest/conversations/v1/conversation';
import each from 'jest-each';
import helpers, { MockedResponse, RecursivePartial } from '../../helpers';
import { Body, handler } from '../../../functions/webhooks/telegram/FlexToTelegram.protected';

global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

const CH_TELEGRAM_CONVERSATION_SID = 'CH_TELEGRAM_CONVERSATION_SID';

let baseContext: Context<{ TELEGRAM_FLEX_BOT_TOKEN: string }> = {} as Context<{
  TELEGRAM_FLEX_BOT_TOKEN: string;
}>;

let baseEvent: Body;
let baseTwilioClient: RecursivePartial<Twilio> = {};
let conversationContext: RecursivePartial<ConversationContext>;

beforeAll(() => {
  conversationContext = {
    fetch: async () => ({
      attributes: '{}',
      sid: CH_TELEGRAM_CONVERSATION_SID,
    }),
    messages: {
      create: jest.fn().mockImplementation(async () => ({ response: 'property' })),
    },
  };

  baseTwilioClient = {
    conversations: {
      conversations: {
        get: () => conversationContext,
      },
    },
  };
  baseContext = {
    DOMAIN_NAME: 'serverless',
    ACCOUNT_SID: 'ACCOUNT_SID',
    TELEGRAM_FLEX_BOT_TOKEN: 'TELEGRAM_FLEX_BOT_TOKEN',
    PATH: '',
    SERVICE_SID: undefined,
    ENVIRONMENT_SID: undefined,
    getTwilioClient: jest.fn().mockReturnValue(baseTwilioClient),
  } as Context<{ TELEGRAM_FLEX_BOT_TOKEN: string }>;

  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({ ok: true }),
  } as Response);

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

  conversationContext = {
    fetch: async () => ({
      attributes: JSON.stringify({
        participantSid: 'flex_participant_id',
      }),
      sid: CH_TELEGRAM_CONVERSATION_SID,
    }),
  };

  baseTwilioClient = {
    conversations: {
      conversations: {
        get: () => conversationContext,
      },
    },
  };

  const partialEvent: RecursivePartial<Body> = {
    ConversationSid: CH_TELEGRAM_CONVERSATION_SID,
    Body: 'Flex to Telegram text',
    EventType: 'onMessageAdded',
    Source: 'API',
    ParticipantSid: 'telegram_participant_id',
    recipientId: 'telegram_recipient_id',
  };
  baseEvent = partialEvent as Body;
});

const testCases: readonly (keyof Body)[] = [
  'ConversationSid',
  'Body',
  'EventType',
  'Source',
] as const;

const verifyTelegramMessageRequestSent = (response: MockedResponse) => {
  expect(mockFetch).toHaveBeenCalledWith(
    'https://api.telegram.org/botTELEGRAM_FLEX_BOT_TOKEN/sendMessage',
    {
      method: 'post',
      body: JSON.stringify({
        chat_id: 'telegram_recipient_id',
        text: 'Flex to Telegram text',
      }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
  expect(response.getBody()).toStrictEqual({
    ok: true,
    resultCode: 200,
    body: { ok: true },
    meta: { 'content-type': 'application/json' },
  });
  expect(response.getStatus()).toBe(200);
};

each(testCases).test('Missing required properties in event - 400', async (prop: keyof Body) => {
  const callback = jest.fn();
  const { [prop]: removed, ...eventWithoutConversationSid } = baseEvent;
  await handler(baseContext, eventWithoutConversationSid as Body, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(400);
});

test('API Source and event ParticipantSid same as conversation attributes participantSid - 400', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, ParticipantSid: 'flex_participant_id' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});

test('API Source and event ParticipantSid same as conversation attributes participantSid - ignored (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, ParticipantSid: 'flex_participant_id' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(mockFetch).not.toHaveBeenCalled();
  expect(response.getStatus()).toBe(200);
});

test('API Source and event ParticipantSid different conversation attributes participantSid - sent (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyTelegramMessageRequestSent(response);
  expect(response.getStatus()).toBe(200);
});

test('SDK Source and event ParticipantSid same as conversation attributes participantSid - sent (200)', async () => {
  const callback = jest.fn();
  await handler(
    baseContext,
    { ...baseEvent, Source: 'SDK', ParticipantSid: 'flex_participant_id' },
    callback,
  );
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyTelegramMessageRequestSent(response);
});

test('SDK Source and event ParticipantSid different conversation attributes participantSid - sent (200)', async () => {
  const callback = jest.fn();
  await handler(baseContext, { ...baseEvent, Source: 'SDK' }, callback);
  const response: MockedResponse = callback.mock.calls[0][1];
  verifyTelegramMessageRequestSent(response);
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
