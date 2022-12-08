import {
  EventFields,
  EventType,
  TASK_CREATED,
  TASK_WRAPUP,
  TASK_CANCELED,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';

import * as janitorListener from '../../functions/taskrouterListeners/janitorListener.private';

const postSurveyTaskAttributes = {
  isSurveyTask: true,
  channelSid: 'channelSid',
};

const nonPostSurveyTaskAttributes = {
  isSurveyTask: false,
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

const context = {
  ...mock<Context<EnvVars>>(),
  CHAT_SERVICE_SID: 'CHxxx',
  FLEX_PROXY_SERVICE_SID: 'KCxxx',
};

const channelJanitorMock = jest.fn();

beforeEach(() => {
  const functions = {
    'helpers/chatChannelJanitor': {
      path: 'helpers/chatChannelJanitor',
    },
    'helpers/customChannels/customChannelToFlex': {
      path: 'helpers/customChannels/customChannelToFlex',
    },
  };
  jest.spyOn(Runtime, 'getFunctions').mockReturnValue(functions);

  const channelJanitorModule = {
    chatChannelJanitor: channelJanitorMock,
  };
  jest.doMock('helpers/chatChannelJanitor', () => channelJanitorModule, { virtual: true });

  jest.doMock(
    'helpers/customChannels/customChannelToFlex',
    () => ({
      isAseloCustomChannel: (channelType: string) => {
        if (channelType === customChannelTaskAttributes.channelType) {
          return true;
        }
        return false;
      },
    }),
    {
      virtual: true,
    },
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Post-survey cleanup', () => {
  test('task wrapup', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_WRAPUP as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'postSurveyTask',
      TaskAttributes: JSON.stringify(postSurveyTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    const { channelSid } = postSurveyTaskAttributes;
    expect(channelJanitorMock).toHaveBeenCalledWith(context, { channelSid });
  });

  test('task canceled', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CANCELED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'postSurveyTask',
      TaskAttributes: JSON.stringify(postSurveyTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    const { channelSid } = postSurveyTaskAttributes;
    expect(channelJanitorMock).toHaveBeenCalledWith(context, { channelSid });
  });

  test('not task wrapup/created', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CREATED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'postSurveyTask',
      TaskAttributes: JSON.stringify(postSurveyTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    expect(channelJanitorMock).not.toHaveBeenCalled();
  });

  test('non post-survey task wrapup', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_WRAPUP as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'nonPostSurveyTask',
      TaskAttributes: JSON.stringify(nonPostSurveyTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    expect(channelJanitorMock).not.toHaveBeenCalled();
  });
});

describe('Custom channel cleanup', () => {
  test('task deleted', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_DELETED as EventType,
      TaskChannelUniqueName: 'custom',
      TaskSid: 'customChannelTask',
      TaskAttributes: JSON.stringify(customChannelTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    const { channelSid } = customChannelTaskAttributes;
    expect(channelJanitorMock).toHaveBeenCalledWith(context, { channelSid });
  });

  test('task system deleted', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_SYSTEM_DELETED as EventType,
      TaskChannelUniqueName: 'custom',
      TaskSid: 'customChannelTask',
      TaskAttributes: JSON.stringify(customChannelTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    const { channelSid } = customChannelTaskAttributes;
    expect(channelJanitorMock).toHaveBeenCalledWith(context, { channelSid });
  });

  test('task system deleted', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_CANCELED as EventType,
      TaskChannelUniqueName: 'custom',
      TaskSid: 'customChannelTask',
      TaskAttributes: JSON.stringify(customChannelTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    const { channelSid } = customChannelTaskAttributes;
    expect(channelJanitorMock).toHaveBeenCalledWith(context, { channelSid });
  });

  test('non custom channel task deleted', async () => {
    const event = {
      ...mock<EventFields>(),
      EventType: TASK_DELETED as EventType,
      TaskChannelUniqueName: 'chat',
      TaskSid: 'nonCustomChannelTask',
      TaskAttributes: JSON.stringify(nonCustomChannelTaskAttributes),
    };
    await janitorListener.handleEvent(context, event);

    expect(channelJanitorMock).not.toHaveBeenCalled();
  });
});
