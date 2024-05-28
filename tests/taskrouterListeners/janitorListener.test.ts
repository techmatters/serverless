/* eslint-disable no-underscore-dangle */
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

import {
  EventFields,
  EventType,
  TASK_WRAPUP,
  TASK_COMPLETED,
  TASK_CANCELED,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';

import each from 'jest-each';
import * as janitorListener from '../../functions/taskrouterListeners/janitorListener.private';
import { AseloCustomChannels } from '../../functions/helpers/customChannels/customChannelToFlex.private';
import helpers from '../helpers';

const mockChannelJanitor = jest.fn();
jest.mock('../../functions/helpers/chatChannelJanitor.private', () => ({
  chatChannelJanitor: mockChannelJanitor,
}));

const captureControlTaskAttributes = {
  isChatCaptureControl: true,
  channelSid: 'channelSid',
};

const nonPostSurveyTaskAttributes = {
  channelSid: 'channelSid',
};

const customChannelTaskAttributes = {
  channelSid: 'customChannelSid',
  channelType: 'twitter',
};

const nonCustomChannelTaskAttributes = {
  channelSid: 'channelSid',
  channelType: 'web',
};

type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const mockFetchFlexApiConfig = jest.fn(() => ({
  attributes: {
    feature_flags: {
      enable_post_survey: true,
    },
  },
}));
const context = {
  ...mock<Context<EnvVars>>(),
  getTwilioClient: (): any => ({
    flexApi: { configuration: { get: () => ({ fetch: mockFetchFlexApiConfig }) } },
  }),
  CHAT_SERVICE_SID: 'CHxxx',
  FLEX_PROXY_SERVICE_SID: 'KCxxx',
  SYNC_SERVICE_SID: 'xxx',
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime(context);
  runtime._addFunction(
    'helpers/chatChannelJanitor',
    'functions/helpers/chatChannelJanitor.private',
  );
  runtime._addFunction(
    'helpers/customChannels/customChannelToFlex',
    'functions/helpers/customChannels/customChannelToFlex.private',
  );
  runtime._addFunction(
    'channelCapture/channelCaptureHandlers',
    'functions/channelCapture/channelCaptureHandlers.private',
  );
  runtime._addFunction('transfer/helpers', 'functions/transfer/helpers.private');
  helpers.setup({}, runtime);
});
afterAll(() => {
  helpers.teardown();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('isCleanupBotCapture', () => {
  each(['web', ...Object.values(AseloCustomChannels)].map((channelType) => ({ channelType }))).test(
    'capture control task canceled with channelType $channelType, should trigger janitor',
    async ({ channelType }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: TASK_CANCELED as EventType,
        TaskAttributes: JSON.stringify({ ...captureControlTaskAttributes, channelType }),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      const { channelSid } = captureControlTaskAttributes;
      expect(mockChannelJanitor).toHaveBeenCalledWith(context, { channelSid });
    },
  );

  each([TASK_WRAPUP, TASK_DELETED, TASK_SYSTEM_DELETED].map((eventType) => ({ eventType }))).test(
    'not task canceled ($eventType), shouldnt trigger janitor',
    async ({ eventType }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: eventType,
        TaskAttributes: JSON.stringify(captureControlTaskAttributes),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      expect(mockChannelJanitor).not.toHaveBeenCalled();
    },
  );

  test('non isCleanupBotCapture task cancel, shouldnt trigger janitor', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CANCELED as EventType,
      TaskAttributes: JSON.stringify(nonPostSurveyTaskAttributes),
      TaskChannelUniqueName: 'chat',
    };
    await janitorListener.handleEvent(context, event);

    expect(mockChannelJanitor).not.toHaveBeenCalled();
  });
});

describe('isCleanupCustomChannel', () => {
  each(
    [TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].flatMap((eventType) =>
      Object.values(AseloCustomChannels).map((channelType) => ({ channelType, eventType })),
    ),
  ).test(
    'eventType $eventType with channelType $channelType, should trigger janitor',
    async ({ channelType, eventType }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: eventType as EventType,
        TaskAttributes: JSON.stringify({ ...customChannelTaskAttributes, channelType }),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      const { channelSid } = customChannelTaskAttributes;
      expect(mockChannelJanitor).toHaveBeenCalledWith(context, { channelSid });
    },
  );

  each([TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].map((eventType) => ({ eventType }))).test(
    'eventType $eventType with non custom channel, should not trigger janitor',
    async ({ eventType }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: eventType as EventType,
        TaskAttributes: JSON.stringify(nonCustomChannelTaskAttributes),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      expect(mockChannelJanitor).not.toHaveBeenCalled();
    },
  );

  each([
    ...Object.values(AseloCustomChannels).map((channelType) => ({
      description: `is rejected transfer task for channelType ${channelType}`,
      taskAttributes: {
        ...customChannelTaskAttributes,
        channelType,
        transferMeta: { sidWithTaskControl: 'not this task' },
      },
    })),
    ...['web', 'sms', 'whatsapp', 'facebook'].map((channelType) => ({
      description: `is not custom channel (channelType ${channelType})`,
      taskAttributes: {
        ...customChannelTaskAttributes,
        channelType,
      },
    })),
  ]).test(
    'canceled task for custom channel $description, should not trigger janitor',
    async ({ taskAttributes }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: TASK_CANCELED as EventType,
        TaskAttributes: JSON.stringify(taskAttributes),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      expect(mockChannelJanitor).not.toHaveBeenCalled();
    },
  );
  each(
    Object.values(AseloCustomChannels).flatMap((channelType) =>
      [TASK_DELETED, TASK_SYSTEM_DELETED].map((eventType) => ({
        description: `is capture control task for channelType ${channelType}`,
        eventType,
        taskAttributes: { ...captureControlTaskAttributes, channelType },
      })),
    ),
  ).test(
    '$eventType for custom channel $description, should not trigger janitor',
    async ({ taskAttributes, eventType }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: eventType as EventType,
        TaskAttributes: JSON.stringify(taskAttributes),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      expect(mockChannelJanitor).not.toHaveBeenCalled();
    },
  );
});

describe('isDeactivateConversationOrchestration', () => {
  each(
    // [TASK_WRAPUP, TASK_COMPLETED, TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].flatMap(
    [TASK_WRAPUP, TASK_COMPLETED].flatMap((eventType) =>
      [...Object.values(AseloCustomChannels), 'web', 'sms', 'whatsapp', 'facebook'].map(
        (channelType) => ({ channelType, eventType }),
      ),
    ),
  ).test(
    'when enable_post_survey=true, eventType $eventType with channelType $channelType, should not trigger janitor',
    async ({ channelType, eventType }) => {
      mockFetchFlexApiConfig.mockImplementationOnce(() => ({
        attributes: {
          feature_flags: {
            enable_post_survey: true,
          },
        },
      }));
      const event = {
        ...mock<EventFields>(),
        EventType: eventType as EventType,
        TaskAttributes: JSON.stringify({ ...customChannelTaskAttributes, channelType }),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      const { channelSid } = customChannelTaskAttributes;
      expect(mockChannelJanitor).not.toHaveBeenCalledWith(context, { channelSid });
    },
  );

  each(
    [TASK_WRAPUP, TASK_COMPLETED, TASK_DELETED, TASK_SYSTEM_DELETED, TASK_CANCELED].flatMap(
      (eventType) =>
        [...Object.values(AseloCustomChannels), 'web', 'sms', 'whatsapp', 'facebook'].map(
          (channelType) => ({ channelType, eventType }),
        ),
    ),
  ).test(
    'when enable_post_survey=false, eventType $eventType with channelType $channelType, should trigger janitor',
    async ({ channelType, eventType }) => {
      mockFetchFlexApiConfig.mockImplementationOnce(() => ({
        attributes: {
          feature_flags: {
            enable_post_survey: false,
          },
        },
      }));
      const event = {
        ...mock<EventFields>(),
        EventType: eventType as EventType,
        TaskAttributes: JSON.stringify({ ...customChannelTaskAttributes, channelType }),
        TaskChannelUniqueName: 'chat',
      };
      await janitorListener.handleEvent(context, event);

      const { channelSid } = customChannelTaskAttributes;
      expect(mockChannelJanitor).toHaveBeenCalledWith(context, { channelSid });
    },
  );
});
