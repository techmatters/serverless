import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import Twit from 'twit';
import {
  handler as FlexToTwitter,
  Body,
} from '../../../functions/webhooks/twitter/FlexToTwitter.protected';

import helpers, { MockedResponse } from '../../helpers';

jest.mock('twit');

const channels: { [x: string]: any } = {
  ChannelSid: {
    sid: 'ChannelSid',
    attributes: JSON.stringify({ from: 'from' }),
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
  }),
  DOMAIN_NAME: 'serverless',
  TWITTER_CONSUMER_KEY: 'TWITTER_CONSUMER_KEY',
  TWITTER_CONSUMER_SECRET: 'TWITTER_CONSUMER_SECRET',
  TWITTER_ACCESS_TOKEN: 'TWITTER_ACCESS_TOKEN',
  TWITTER_ACCESS_TOKEN_SECRET: 'TWITTER_ACCESS_TOKEN_SECRET',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
};

describe('FlexToTwitter', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });
  afterEach(() => {
    // @ts-ignore
    Twit.mockClear();
  });

  test('Should return status 400', async () => {
    const event1: Body = {
      recipientId: undefined,
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
      expect(response.getBody().message).toContain('Error: recipientId parameter not provided');
    };

    await FlexToTwitter(baseContext, event1, callback1);

    const event2: Body = {
      recipientId: 'recipientId',
      Body: undefined,
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
      expect(response.getBody().message).toContain('Error: Body parameter not provided');
    };

    await FlexToTwitter(baseContext, event2, callback2);

    const event3: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: undefined,
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
      expect(response.getBody().message).toContain('Error: ChannelSid parameter not provided');
    };

    await FlexToTwitter(baseContext, event3, callback3);
  });

  test('Should return status 406', async () => {
    const event: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'other source',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(406);
      expect(response.getBody()).toContain('Event Source not supported');
    };

    await FlexToTwitter(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    // Bad formatted direct message event
    const event1: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Service does not exists.');
    };

    await FlexToTwitter({ ...baseContext, CHAT_SERVICE_SID: 'not-existing' }, event1, callback1);

    // @ts-ignore
    Twit.mockImplementation(() => {
      throw new Error('Twit failed because of some reason.');
    });

    const event2: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Twit failed because of some reason.');
    };

    await FlexToTwitter(baseContext, event2, callback2);

    // @ts-ignore
    Twit.mockImplementation(() => ({
      post: () => {
        throw new Error('Twit post failed because of some reason.');
      },
    }));

    const event3: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Twit post failed because of some reason.');
    };

    await FlexToTwitter(baseContext, event3, callback3);
  });

  test('Should return status 200 (ignore events)', async () => {
    const event: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
      From: 'from',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Ignored event.');
    };

    await FlexToTwitter(baseContext, event, callback);
  });

  test('Should return status 200 (API)', async () => {
    // @ts-ignore
    Twit.mockImplementation(() => ({
      post: async () => ({ messageSent: true }),
    }));

    const event: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'API',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
      From: 'different-from',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody().messageSent).toBeTruthy();
    };

    await FlexToTwitter(baseContext, event, callback);
  });

  test('Should return status 200 (SDK)', async () => {
    // @ts-ignore
    Twit.mockImplementation(() => ({
      post: async () => ({ messageSent: true }),
    }));

    const event: Body = {
      recipientId: 'recipientId',
      Body: 'Body',
      Source: 'SDK',
      EventType: 'onMessageSent',
      ChannelSid: 'ChannelSid',
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody().messageSent).toBeTruthy();
    };

    await FlexToTwitter(baseContext, event, callback);
  });
});
