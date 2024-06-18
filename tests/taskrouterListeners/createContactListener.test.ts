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
  TASK_CREATED,
  TASK_WRAPUP,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';

import * as contactListener from '../../functions/taskrouterListeners/createContactListener.private';

const functions = {
  'helpers/addCustomerExternalId': {
    path: 'helpers/addCustomerExternalId',
  },
  'helpers/addTaskSidToChannelAttributes': {
    path: 'helpers/addTaskSidToChannelAttributes',
  },
};
global.Runtime.getFunctions = () => functions;

const facebookTaskAttributes = {
  isContactlessTask: false,
  channelType: 'facebook',
};

const webTaskAttributes = {
  isContactlessTask: false,
  channelType: 'web',
};

const contaclessTaskAttributes = {
  isContactlessTask: true,
  channelType: 'web',
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
};

const context = {
  ...mock<Context<EnvVars>>(),
  TWILIO_WORKSPACE_SID: 'WSxxx',
  CHAT_SERVICE_SID: 'CHxxx',
};

const addCustomerExternalIdMock = jest.fn();
const addTaskSidToChannelAttributesMock = jest.fn();

beforeEach(() => {
  jest.doMock(
    'helpers/addCustomerExternalId',
    () => ({ addCustomerExternalId: addCustomerExternalIdMock }),
    { virtual: true },
  );
  jest.doMock(
    'helpers/addTaskSidToChannelAttributes',
    () => ({ addTaskSidToChannelAttributes: addTaskSidToChannelAttributesMock }),
    {
      virtual: true,
    },
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Create contact', () => {
  test('add customerExternalId', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CREATED as EventType,
      TaskAttributes: JSON.stringify(facebookTaskAttributes),
    };

    await contactListener.handleEvent(context, event);

    expect(addCustomerExternalIdMock).toHaveBeenCalledWith(context, event);
    expect(addTaskSidToChannelAttributesMock).not.toHaveBeenCalled();
  });

  test('add TaskSid to channel attributes', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CREATED as EventType,
      TaskAttributes: JSON.stringify(webTaskAttributes),
    };

    await contactListener.handleEvent(context, event);

    expect(addCustomerExternalIdMock).toHaveBeenCalledWith(context, event);
    expect(addTaskSidToChannelAttributesMock).toHaveBeenCalledWith(context, event);
  });

  test('contactless task do not add customerExternalId', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CREATED as EventType,
      TaskAttributes: JSON.stringify(contaclessTaskAttributes),
    };

    await contactListener.handleEvent(context, event);

    expect(addCustomerExternalIdMock).not.toHaveBeenCalled();
    expect(addTaskSidToChannelAttributesMock).not.toHaveBeenCalled();
  });

  test('task wrapup do not add customerExternalId', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_WRAPUP as EventType,
      TaskAttributes: JSON.stringify(facebookTaskAttributes),
    };

    await contactListener.handleEvent(context, event);

    expect(addCustomerExternalIdMock).not.toHaveBeenCalled();
    expect(addTaskSidToChannelAttributesMock).not.toHaveBeenCalled();
  });
});
