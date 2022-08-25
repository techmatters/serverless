import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import each from 'jest-each';
import { handler as TwitterToFlex, Body } from '../../../functions/webhooks/twitter/TwitterToFlex';

import helpers, { MockedResponse } from '../../helpers';

jest.mock('crypto', () => ({
  timingSafeEqual: () => true,
  createHmac: () => ({ update: () => ({ digest: () => '' }) }),
}));

const channels: { [x: string]: any } = {
  'twitter:sender_id': {
    attributes: '{}',
    sid: 'twitter:sender_id',
    messages: {
      create: async () => 'Message sent in channel twitter:sender_id.',
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
  'twitter:other_id': {
    attributes: '{}',
    sid: 'twitter:other_id',
    messages: {
      create: async () => 'Message sent in channel twitter:other_id.',
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
};

let documents: any = {
  'twitter:sender_id': { data: { activeChannelSid: 'twitter:sender_id' } },
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

          if (identity.includes('sender_id')) return channels['twitter:sender_id'];

          return channels['twitter:other_id'];
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
  TWITTER_CONSUMER_KEY: 'TWITTER_CONSUMER_KEY',
  TWITTER_CONSUMER_SECRET: 'TWITTER_CONSUMER_SECRET',
  TWITTER_ACCESS_TOKEN: 'TWITTER_ACCESS_TOKEN',
  TWITTER_ACCESS_TOKEN_SECRET: 'TWITTER_ACCESS_TOKEN_SECRET',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  TWITTER_FLEX_FLOW_SID: 'TWITTER_FLEX_FLOW_SID',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const validEventBody = ({ senderId = 'sender_id', recipientId = 'recipient_id' } = {}): Body => ({
  bodyAsString: 'fake body',
  xTwitterWebhooksSignature: 'fake signature',
  direct_message_events: [
    {
      type: 'type',
      created_timestamp: 'created_timestamp',
      id: 'id',
      message_create: {
        recipient_id: recipientId,
        sender_id: senderId,
        target: 'target',
        message_data: {
          text: 'text',
          entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
        },
      },
    },
  ],
  for_user_id: recipientId,
  users: {
    [senderId]: { name: senderId, screen_name: senderId },
    [recipientId]: { name: recipientId, screen_name: recipientId },
  },
});

describe('TwitterToFlex', () => {
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
      conditionDescription: 'the event contains no direct message events',
      event: { ...validEventBody(), direct_message_events: [] },
      expectedStatus: 500,
      expectedMessage: 'Bad formatted direct message event',
    },
    {
      conditionDescription: 'the event has no for_user_id property',
      event: { ...validEventBody(), for_user_id: undefined },
      expectedStatus: 500,
      expectedMessage: 'Bad formatted direct message event',
    },
    {
      conditionDescription: 'the event has no users',
      event: { ...validEventBody(), users: undefined },
      expectedStatus: 500,
      expectedMessage: 'Bad formatted direct message event',
    },
    {
      conditionDescription: 'the flex flow identified in the TWITTER_FLEX_FLOW_SID does not exist',
      event: validEventBody({ senderId: 'other_sender_id' }),
      flexFlowSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Flex Flow does not exists',
    },
    {
      conditionDescription: 'the chat service identified in the CHAT_SERVICE_SID does not exist',
      event: validEventBody({ senderId: 'other_sender_id' }),
      chatServiceSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Service does not exists',
    },
    {
      conditionDescription: 'there is no direct_message_events property',
      event: {
        bodyAsString: 'fake body',
        xTwitterWebhooksSignature: 'fake signature',
        direct_message_events: undefined,
      },
      expectedStatus: 200,
      expectedMessage: 'Ignored event.',
    },
    {
      conditionDescription: 'for_user_id is set to sender ID, not recipient',
      event: { ...validEventBody(), for_user_id: 'sender_id' },
      expectedStatus: 200,
      expectedMessage: 'Ignored event.',
    },
    {
      conditionDescription: 'sending to existing channel',
      event: validEventBody({}),
      expectedStatus: 200,
      expectedMessage: 'Message sent in channel twitter:sender_id.',
    },
    {
      conditionDescription: 'creating a new channel',
      event: validEventBody({ senderId: 'other_id' }),
      expectedStatus: 200,
      expectedMessage: 'Message sent in channel twitter:other_id.',
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
      await TwitterToFlex(
        { ...baseContext, TWITTER_FLEX_FLOW_SID: flexFlowSid, CHAT_SERVICE_SID: chatServiceSid },
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
