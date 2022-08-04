import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import each from 'jest-each';
import { handler as LineToFlex, Body } from '../../../functions/webhooks/line/LineToFlex';

import helpers, { MockedResponse } from '../../helpers';

jest.mock('crypto', () => ({
  timingSafeEqual: () => true,
  createHmac: () => ({ update: () => ({ digest: () => '' }) }),
}));

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
  LINE_CHANNEL_SECRET: 'LINE_CHANNEL_SECRET',
};

const validEvent = ({ senderId = 'sender_id', recipientId = 'recipient_id' } = {}): Body => ({
  request: {
    headers: {
      'x-line-signature': 'line_signature',
    },
  },
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

const aggregateEvents = (event1: Body, event2: Body): Body => ({
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
      expectedMessage:
        'Message sent in channel line:sender_id.,Message sent in channel line:sender_id.',
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
        { ...baseContext, LINE_FLEX_FLOW_SID: flexFlowSid, CHAT_SERVICE_SID: chatServiceSid },
        event,
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
