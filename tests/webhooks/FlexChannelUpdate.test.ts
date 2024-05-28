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
import {
  handler as FlexChannelUpdate,
  Body,
} from '../../functions/webhooks/FlexChannelUpdate.protected';

import helpers, { MockedResponse } from '../helpers';

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
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('FlexChannelUpdate', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime(baseContext);
    // eslint-disable-next-line no-underscore-dangle
    runtime._addFunction(
      'helpers/chatChannelJanitor',
      'functions/helpers/chatChannelJanitor.private',
    );
    helpers.setup({}, runtime);
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
      expect(response.getBody().message).toContain('Service does not exists.');
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
      expect(response.getBody().message).toContain('Channel does not exists.');
      expect(mockDocRemove).not.toHaveBeenCalled();
    };

    await FlexChannelUpdate(baseContext, event2, callback2);
  });

  test('Should return status 200 (ignore events)', async () => {
    const event1: Body = {
      EventType: 'someOtherEvent' as 'onChannelUpdated',
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
