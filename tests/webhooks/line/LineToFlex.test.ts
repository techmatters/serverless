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
import each from 'jest-each';
import crypto from 'crypto';
import { handler as LineToFlex, Body } from '../../../functions/webhooks/line/LineToFlex';

import helpers, { MockedResponse } from '../../helpers';

const channels: { [x: string]: any } = {
  'line:sender_id': {
    attributes: '{}',
    sid: 'line:sender_id',
    messages: {
      create: async () => 'Message sent in channel line:sender_id.',
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
  'line:other_id': {
    attributes: '{}',
    sid: 'line:other_id',
    messages: {
      create: async () => 'Message sent in channel line:other_id.',
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
};

let documents: any = {
  'line:sender_id': { data: { activeChannelSid: 'line:sender_id' } },
};

function documentsMock(doc: string) {
  return {
    fetch: async () => {
      if (!documents[doc]) throw new Error('Document does not exists');

      return documents[doc];
    },
  };
}
documentsMock.create = async ({ data, uniqueName }: { data: any; uniqueName: string }) => {
  documents = { ...documents, [uniqueName]: { data } };
  return documents[uniqueName];
};

const baseContext = {
  getTwilioClient: (): any => ({
    chat: {
      services: (serviceSid: string) => {
        if (serviceSid === 'not-existing') throw new Error('Service does not exists.');

        return {
          channels: (channelSid: string) => {
            if (!channels[channelSid]) throw new Error('Channel does not exists.');

            return { fetch: async () => channels[channelSid], ...channels[channelSid] };
          },
        };
      },
    },
    flexApi: {
      channel: {
        create: async ({ flexFlowSid, identity }: { flexFlowSid: string; identity: string }) => {
          if (flexFlowSid === 'not-existing') throw new Error('Flex Flow does not exists.');

          if (identity.includes('sender_id')) return channels['line:sender_id'];

          return channels['line:other_id'];
        },
      },
    },
    sync: {
      services: () => ({
        documents: documentsMock,
      }),
    },
  }),
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  AUTH_TOKEN: 'AUTH_TOKEN',
  SYNC_SERVICE_SID: 'SYNC_SERVICE_SID',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  LINE_FLEX_FLOW_SID: 'LINE_FLEX_FLOW_SID',
  PATH: '',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

type UnsignedBody = Omit<Body, 'request'>;

const fixUnicodeForLine = (text: string): string =>
  text.replace(/\p{Emoji_Presentation}/gu, (emojiChars) =>
    emojiChars
      .split('')
      .map((c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`)
      .join(''),
  );

const signEvent = (event: UnsignedBody, secret: string): Body => ({
  ...event,
  request: {
    headers: {
      'x-line-signature': crypto
        .createHmac('sha256', secret)
        .update(fixUnicodeForLine(JSON.stringify(event)))
        .digest('base64'),
    },
  },
});

const validEvent = ({
  senderId = 'sender_id',
  recipientId = 'recipient_id',
} = {}): UnsignedBody => ({
  destination: recipientId,
  events: [
    {
      type: 'message',
      message: {
        type: 'text',
        id: 'message_id',
        text: 'text',
      },
      timestamp: Date.now(),
      replyToken: 'reply_token',
      source: {
        type: 'user',
        userId: senderId,
      },
    },
  ],
});

const aggregateEvents = (event1: UnsignedBody, event2: UnsignedBody): UnsignedBody => ({
  ...event1,
  events: [...event1.events, ...event2.events],
});

describe('LineToFlex', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime(baseContext);
    // eslint-disable-next-line no-underscore-dangle
    runtime._addFunction(
      'helpers/customChannels/customChannelToFlex',
      'functions/helpers/customChannels/customChannelToFlex.private',
    );
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('should return 403 for an unsigned event', async () => {
    const event = validEvent();
    const context = baseContext;
    const callback = jest.fn();

    await LineToFlex(
      { ...context, LINE_CHANNEL_SECRET: 'mock-correct-secret' },
      { ...event, request: { headers: {} } },
      callback,
    );
    const response: MockedResponse = callback.mock.calls[0][1];

    expect(response!.getStatus()).toBe(403);
    expect(response!.getBody().message).toContain('Forbidden');
  });

  test('should return 403 for an incorrectly signed event', async () => {
    const event = validEvent();
    const context = baseContext;
    const callback = jest.fn();

    await LineToFlex(
      { ...context, LINE_CHANNEL_SECRET: 'mock-correct-secret' },
      signEvent(event, 'mock-wrong-secret'),
      callback,
    );
    const response: MockedResponse = callback.mock.calls[0][1];

    expect(response!.getStatus()).toBe(403);
    expect(response!.getBody().message).toContain('Forbidden');
  });

  each([
    {
      conditionDescription: 'the event contains no message events',
      event: { ...validEvent(), events: [] },
      expectedStatus: 200,
      expectedMessage: 'No messages to send',
    },
    {
      conditionDescription: 'the event has no destination property',
      event: { ...validEvent(), destination: undefined },
      expectedStatus: 500,
      expectedMessage: 'Missing destination property',
    },
    {
      conditionDescription: 'the flex flow identified in the LINE_FLEX_FLOW_SID does not exist',
      event: validEvent({ senderId: 'other_sender_id' }),
      flexFlowSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Flex Flow does not exists',
    },
    {
      conditionDescription: 'the chat service identified in the CHAT_SERVICE_SID does not exist',
      event: validEvent({ senderId: 'other_sender_id' }),
      chatServiceSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Service does not exists',
    },
    {
      conditionDescription: 'destination is set to sender ID, not recipient',
      event: { ...validEvent(), destination: 'sender_id' },
      expectedStatus: 200,
      expectedMessage: 'Ignored event.',
    },
    {
      conditionDescription: 'sending to existing channel',
      event: validEvent({}),
      expectedStatus: 200,
      expectedMessage: 'Message sent in channel line:sender_id.',
    },
    {
      conditionDescription: 'creating a new channel',
      event: validEvent({ senderId: 'other_id' }),
      expectedStatus: 200,
      expectedMessage: 'Message sent in channel line:other_id.',
    },
    {
      conditionDescription: 'sending multiple events',
      event: aggregateEvents(validEvent({}), validEvent({})),
      expectedStatus: 200,
      expectedMessage: `${JSON.stringify({
        status: 'sent',
        response: 'Message sent in channel line:sender_id.',
      })},${JSON.stringify({
        status: 'sent',
        response: 'Message sent in channel line:sender_id.',
      })}`,
    },
    {
      conditionDescription: 'sending emoji',
      event: {
        ...validEvent(),
        events: [
          {
            ...validEvent().events[0],
            message: {
              type: 'text',
              id: 'message_id',
              text: 'Oh noes! 😭',
            },
          },
        ],
      },
      expectedStatus: 200,
      expectedMessage: 'Message sent in channel line:sender_id.',
    },
  ]).test(
    "Should return error expectedStatus '$expectedMessage' when $conditionDescription",
    async ({
      event,
      expectedStatus,
      expectedMessage,
      flexFlowSid = 'TWITTER_FLEX_FLOW_SID',
      chatServiceSid = 'CHAT_SERVICE_SID',
    }) => {
      let response: MockedResponse | undefined;

      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };
      await LineToFlex(
        {
          ...baseContext,
          LINE_CHANNEL_SECRET: 'mock-correct-secret',
          LINE_FLEX_FLOW_SID: flexFlowSid,
          CHAT_SERVICE_SID: chatServiceSid,
        },
        signEvent(event, 'mock-correct-secret'),
        callback,
      );

      expect(response).toBeDefined();
      if (response) {
        expect({
          status: response.getStatus(),
          message: expectedStatus === 200 ? response.getBody() : response.getBody().message,
        }).toMatchObject({
          status: expectedStatus,
          message: expect.stringContaining(expectedMessage),
        });
      }
    },
  );
});
