import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  handler as FlexChannelUpdate,
  Body,
} from '../../../functions/webhooks/twitter/FlexChannelUpdate.protected';

import helpers, { MockedResponse } from '../../helpers';

const channels: { [x: string]: any } = {
  activeChannel: {
    sid: 'activeChannel',
    attributes: JSON.stringify({ status: 'ACTIVE', from: 'activeChannel' }),
    membersCount: 1,
  },
  inactiveChannel: {
    sid: 'inactiveChannel',
    attributes: JSON.stringify({ status: 'INACTIVE', from: 'inactiveChannel' }),
    membersCount: 1,
  },
  twoMembers: {
    sid: 'twoMembers',
    attributes: JSON.stringify({ status: 'INACTIVE', from: 'twoMembers' }),
    membersCount: 2,
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockDocRemove = jest.fn((doc: string) => true);

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
    sync: {
      services: () => ({
        documents: (doc: string) => ({
          remove: async () => mockDocRemove(doc),
        }),
      }),
    },
  }),
  DOMAIN_NAME: 'serverless',
  CHAT_SERVICE_SID: 'chatService',
  SYNC_SERVICE_SID: 'SYNC_SERVICE_SID',
};

describe('FlexChannelUpdate', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });
  afterEach(() => {
    mockDocRemove.mockClear();
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
      expect(mockDocRemove).not.toHaveBeenCalled();
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
      expect(mockDocRemove).not.toHaveBeenCalled();
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
      expect(mockDocRemove).not.toHaveBeenCalled();
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
      expect(mockDocRemove).not.toHaveBeenCalled();
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
      expect(mockDocRemove).not.toHaveBeenCalled();
    };

    await FlexChannelUpdate(baseContext, event2, callback2);
  });

  test('Should return status 200 (one member in channel)', async () => {
    const event1: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'inactiveChannel',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain(
        'INACTIVE channel triggered map removal for inactiveChannel, removed true',
      );
      expect(mockDocRemove).toHaveBeenCalled();
    };

    await FlexChannelUpdate(baseContext, event1, callback1);
  });

  test('Should return status 200 (two members in channel)', async () => {
    const event1: Body = {
      EventType: 'onChannelUpdated',
      ChannelSid: 'twoMembers',
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
      expect(response.getBody()).toContain(
        'INACTIVE channel triggered map removal for twoMembers, removed true',
      );
      expect(mockDocRemove).toHaveBeenCalled();
    };

    await FlexChannelUpdate(baseContext, event1, callback1);
  });
});
