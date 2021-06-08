import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as TwitterToFlex, Body } from '../../../functions/webhooks/twitter/TwitterToFlex';

import helpers, { MockedResponse } from '../../helpers';

const channels: { [x: string]: any } = {
  'twitter:sender_id': {
    sid: 'twitter:sender_id',
    messages: {
      create: async () => 'Message sent in channel twitter:sender_id.',
    },
    webhooks: {
      create: async () => {},
    },
  },
  'twitter:other_id': {
    sid: 'twitter:other_id',
    messages: {
      create: async () => 'Message sent in channel twitter:other_id.',
    },
    webhooks: {
      create: async () => {},
    },
  },
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
  }),
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  AUTH_TOKEN: 'AUTH_TOKEN',
  TWITTER_CONSUMER_KEY: 'TWITTER_CONSUMER_KEY',
  TWITTER_CONSUMER_SECRET: 'TWITTER_CONSUMER_SECRET',
  TWITTER_ACCESS_TOKEN: 'TWITTER_ACCESS_TOKEN',
  TWITTER_ACCESS_TOKEN_SECRET: 'TWITTER_ACCESS_TOKEN_SECRET',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  TWITTER_FLEX_FLOW_SID: 'TWITTER_FLEX_FLOW_SID',
};

describe('TwitterToFlex', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 500', async () => {
    // Bad formatted direct message event
    const event1: Body = {
      direct_message_events: [],
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Bad formatted direct message event');
    };

    await TwitterToFlex(baseContext, event1, callback1);

    const event2: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'sender_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Bad formatted direct message event');
    };

    await TwitterToFlex(baseContext, event2, callback2);

    const event3: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'sender_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
      for_user_id: 'recipient_id',
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Bad formatted direct message event');
    };

    await TwitterToFlex(baseContext, event3, callback3);

    const event4: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'other_sender_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
      for_user_id: 'recipient_id',
      users: {
        other_sender_id: { name: 'other_sender_id', screen_name: 'other_sender_id' },
        recipient_id: { name: 'recipient_id', screen_name: 'recipient_id' },
      },
    };

    const callback4: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Flex Flow does not exists.');
    };

    await TwitterToFlex(
      { ...baseContext, TWITTER_FLEX_FLOW_SID: 'not-existing' },
      event4,
      callback4,
    );

    const event5: Body = event4;

    const callback5: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Service does not exists.');
    };

    await TwitterToFlex({ ...baseContext, CHAT_SERVICE_SID: 'not-existing' }, event5, callback5);
  });

  test('Should return status 200 (ignore events)', async () => {
    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Ignored event.');
    };

    const event1: Body = {
      direct_message_events: undefined,
    };

    await TwitterToFlex(baseContext, event1, callback);

    const event2: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'sender_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
      for_user_id: 'sender_id',
      users: {
        sender_id: { name: 'sender_id', screen_name: 'sender_id' },
        recipient_id: { name: 'recipient_id', screen_name: 'recipient_id' },
      },
    };

    await TwitterToFlex(baseContext, event2, callback);
  });

  test('Should return status 200 (existing channel)', async () => {
    const event: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'sender_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
      for_user_id: 'recipient_id',
      users: {
        sender_id: { name: 'sender_id', screen_name: 'sender_id' },
        recipient_id: { name: 'recipient_id', screen_name: 'recipient_id' },
      },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Message sent in channel twitter:sender_id.');
    };

    await TwitterToFlex(baseContext, event, callback);
  });

  test('Should return status 200 (create channel)', async () => {
    const event: Body = {
      direct_message_events: [
        {
          type: 'type',
          created_timestamp: 'created_timestamp',
          id: 'id',
          message_create: {
            recipient_id: 'recipient_id',
            sender_id: 'other_id',
            target: 'target',
            message_data: {
              text: 'text',
              entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
            },
          },
        },
      ],
      for_user_id: 'recipient_id',
      users: {
        other_id: { name: 'other_id', screen_name: 'other_id' },
        recipient_id: { name: 'recipient_id', screen_name: 'recipient_id' },
      },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Message sent in channel twitter:other_id.');
    };

    await TwitterToFlex(baseContext, event, callback);
  });
});
