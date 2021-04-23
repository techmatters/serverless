import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  handler as FlexChannelUpdate,
  Body,
} from '../../../functions/webhooks/twitter/FlexChannelUpdate.protected';

import helpers, { MockedResponse } from '../../helpers';

const channels: { [x: string]: any } = {
  activeChannel: {
    sid: 'activeChannel',
    attributes: JSON.stringify({ status: 'ACTIVE' }),
    membersCount: 1,
    remove: async () => true,
  },
  inactiveChannel: {
    sid: 'inactiveChannel',
    attributes: JSON.stringify({ status: 'INACTIVE' }),
    membersCount: 1,
    remove: jest.fn(() => true),
  },
  twoMembers: {
    sid: 'twoMembers',
    attributes: JSON.stringify({ status: 'INACTIVE' }),
    membersCount: 2,
    remove: async () => true,
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

            return { fetch: async () => channels[channelSid] };
          },
        };
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  CHAT_SERVICE_SID: 'chatService',
};

describe('FlexChannelUpdate', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should return status 400', async () => {
    const event: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: undefined,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(400);
      expect(response.getBody().message).toContain('Error: ChannelSid parameter not provided');
    };

    await FlexChannelUpdate(baseContext, event, callback);
  });

  test('Should return status 500', async () => {
    const event1: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'non-existing',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Service does not exists.');
    };

    await FlexChannelUpdate(
      { ...baseContext, CHAT_SERVICE_SID: 'not-existing' },
      event1,
      callback1,
    );

    const event2: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'non-existing',
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(500);
      expect(response.getBody().toString()).toContain('Channel does not exists.');
    };

    await FlexChannelUpdate(baseContext, event2, callback2);
  });

  test('Should return status 200 (ignore events)', async () => {
    const event1: Body = {
      EventType: 'someOtherEvent',
      ChannelSid: 'inactiveChannel',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Ignored event.');
    };

    await FlexChannelUpdate(baseContext, event1, callback1);

    const event2: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'activeChannel',
    };

    const callback2: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Ignored event.');
    };

    await FlexChannelUpdate(baseContext, event2, callback2);

    const event3: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'twoMembers',
    };

    const callback3: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('Ignored event.');
    };

    await FlexChannelUpdate(baseContext, event3, callback3);
  });

  test('Should return status 200', async () => {
    channels.inactiveChannel.remove.mockClear();

    const event1: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'inactiveChannel',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain('INACTIVE channel removed: true');
      expect(channels.inactiveChannel.remove).toHaveBeenCalled();
    };

    await FlexChannelUpdate(baseContext, event1, callback1);
    channels.inactiveChannel.remove.mockClear();
  });
});
