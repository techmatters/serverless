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
  RESERVATION_ACCEPTED,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';

import * as adjustCapacityListener from '../../functions/taskrouterListeners/adjustCapacityListener.private';
import helpers from '../helpers';

const mockAdjustChatCapacity = jest.fn().mockResolvedValue({ status: 200, message: 'OK' });
jest.mock('../../functions/adjustChatCapacity.private', () => ({
  adjustChatCapacity: mockAdjustChatCapacity,
}));

const mockFetchFlexApiConfig = jest.fn();

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

const context = {
  ...mock<Context<EnvVars>>(),
  getTwilioClient: (): any => ({
    flexApi: {
      configuration: {
        get: () => ({ fetch: mockFetchFlexApiConfig }),
      },
    },
  }),
  TWILIO_WORKSPACE_SID: 'WSxxx',
  CHAT_SERVICE_SID: 'CHxxx',
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime(context);
  runtime._addFunction('adjustChatCapacity', 'functions/adjustChatCapacity.private');
  helpers.setup({}, runtime);
});

afterAll(() => {
  helpers.teardown();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('use_twilio_lambda_adjust_capacity feature flag', () => {
  test('when use_twilio_lambda_adjust_capacity=true, handler is skipped', async () => {
    mockFetchFlexApiConfig.mockResolvedValueOnce({
      attributes: {
        feature_flags: {
          enable_manual_pulling: true,
          use_twilio_lambda_adjust_capacity: true,
        },
      },
    });

    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      WorkerSid: 'WKxxx',
    };

    await adjustCapacityListener.handleEvent(context, event);

    expect(mockAdjustChatCapacity).not.toHaveBeenCalled();
  });

  test('when use_twilio_lambda_adjust_capacity=false and enable_manual_pulling=true, handler executes', async () => {
    mockFetchFlexApiConfig.mockResolvedValueOnce({
      attributes: {
        feature_flags: {
          enable_manual_pulling: true,
          use_twilio_lambda_adjust_capacity: false,
        },
      },
    });

    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      WorkerSid: 'WKxxx',
    };

    await adjustCapacityListener.handleEvent(context, event);

    expect(mockAdjustChatCapacity).toHaveBeenCalledWith(context, {
      workerSid: 'WKxxx',
      adjustment: 'setTo1',
    });
  });

  test('when use_twilio_lambda_adjust_capacity is not set and enable_manual_pulling=true, handler executes', async () => {
    mockFetchFlexApiConfig.mockResolvedValueOnce({
      attributes: {
        feature_flags: {
          enable_manual_pulling: true,
        },
      },
    });

    const event = {
      ...mock<EventFields>(),
      EventType: RESERVATION_ACCEPTED as EventType,
      TaskChannelUniqueName: 'chat',
      WorkerSid: 'WKxxx',
    };

    await adjustCapacityListener.handleEvent(context, event);

    expect(mockAdjustChatCapacity).toHaveBeenCalledWith(context, {
      workerSid: 'WKxxx',
      adjustment: 'setTo1',
    });
  });
});
