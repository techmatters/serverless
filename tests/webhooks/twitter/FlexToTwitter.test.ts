import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import Twit from 'twit';
import each from 'jest-each';
import { handler as FlexToTwitter } from '../../../functions/webhooks/twitter/FlexToTwitter.protected';

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

let successfulTwitterPost: jest.Mock;
let twitSuccessImpl: () => void;

beforeEach(() => {
  successfulTwitterPost = jest.fn();
  successfulTwitterPost.mockReturnValue(Promise.resolve({ messageSent: true }));
  twitSuccessImpl = () => ({
    post: successfulTwitterPost,
  });
});

describe('FlexToTwitter', () => {
  beforeAll(() => {
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
  afterEach(() => {
    // @ts-ignore
    Twit.mockClear();
  });

  each([
    {
      conditionDescription: 'the recipientId parameter not provided',
      event: {
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
        From: 'different-from',
      },
      expectedStatus: 400,
      expectedMessage: 'Error: recipientId parameter not provided',
    },
    {
      conditionDescription: 'the Body parameter not provided',
      event: {
        recipientId: 'recipientId',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
        From: 'different-from',
      },
      expectedStatus: 400,
      expectedMessage: 'Error: Body parameter not provided',
    },
    {
      conditionDescription: 'the ChannelSid parameter not provided',
      event: {
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        From: 'different-from',
      },
      expectedStatus: 400,
      expectedMessage: 'Error: ChannelSid parameter not provided',
    },
    {
      conditionDescription: 'the chat service for the SID does not exist',
      event: {
        From: 'wherever',
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
      },
      sid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Service does not exists.',
    },
    {
      conditionDescription: 'the Twit instantiation throws an error',
      event: {
        From: 'wherever',
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
      },
      twitImpl: () => {
        throw new Error('Twit instantiation failed because of some reason');
      },
      expectedStatus: 500,
      expectedMessage: 'Twit instantiation failed because of some reason',
    },
    {
      conditionDescription: 'the Twit post throws an error',
      event: {
        From: 'wherever',
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
      },
      twitImpl: () => ({
        post: () => {
          throw new Error('Twit post failed because of some reason');
        },
      }),
      expectedStatus: 500,
      expectedMessage: 'Twit post failed because of some reason',
    },
  ]).test(
    "Should return $expectedStatus '$expectedMessage' error when $conditionDescription.",
    async ({
      event,
      sid = 'CHAT_SERVICE_SID',
      twitImpl = twitSuccessImpl,
      expectedStatus,
      expectedMessage,
    }) => {
      // Bad formatted direct message event
      // @ts-ignore
      Twit.mockImplementation(twitImpl);
      let response: MockedResponse | undefined;
      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };

      await FlexToTwitter({ ...baseContext, CHAT_SERVICE_SID: sid }, event, callback);

      expect(response).toBeDefined();
      if (response) {
        // Matching like this reports the message and the status in the fail message, rather than just one or the other, which you get with 2 separate checks
        expect({ status: response.getStatus(), message: response.getBody().message }).toMatchObject(
          {
            status: expectedStatus,
            message: expect.stringContaining(expectedMessage),
          },
        );
      }
    },
  );

  each([
    {
      conditionDescription: 'the event source is not supported',
      event: {
        From: 'wherever',
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'other source',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
      },
      shouldBeIgnored: true,
    },
    {
      conditionDescription: "event 'From' property matches channel 'from' attribute",
      event: {
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
        From: 'from',
      },
      shouldBeIgnored: true,
    },
    {
      conditionDescription: "event 'Source' property is set to 'API'",
      event: {
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'API',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
        From: 'different-from',
      },
      shouldBeIgnored: false,
    },
    {
      conditionDescription: "event 'Source' property is set to 'SDK'",
      event: {
        From: 'wherever',
        recipientId: 'recipientId',
        Body: 'Body',
        Source: 'SDK',
        EventType: 'onMessageSent',
        ChannelSid: 'ChannelSid',
      },
      shouldBeIgnored: false,
    },
  ]).test(
    'Should return status 200 success (ignored: $shouldBeIgnored) when $conditionDescription.',
    async ({ event, shouldBeIgnored }) => {
      // @ts-ignore
      Twit.mockImplementation(twitSuccessImpl);

      let response: MockedResponse | undefined;
      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };

      await FlexToTwitter(baseContext, event, callback);

      if (shouldBeIgnored) {
        expect(successfulTwitterPost).not.toBeCalled();
      } else {
        expect(successfulTwitterPost).toBeCalled();
      }

      expect(response).toBeDefined();
      if (response) {
        expect({ status: response.getStatus(), body: response.getBody() }).toMatchObject({
          status: 200,
          body: shouldBeIgnored ? expect.stringContaining('Ignored event.') : expect.anything(),
        });
      }
    },
  );
});
