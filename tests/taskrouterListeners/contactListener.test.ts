import {
  EventFields,
  EventType,
  TASK_CREATED,
  TASK_WRAPUP,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';

import * as contactListener from '../../functions/taskrouterListeners/contactListener.private';

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
