import {
  EventFields,
  EventType,
  TASK_CREATED,
  TASK_WRAPUP,
  TASK_CANCELED,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
  TASK_COMPLETED,
  TASK_UPDATED,
} from '@tech-matters/serverless-helpers/taskrouter';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import { mock } from 'jest-mock-extended';
import each from 'jest-each';

import * as postSurveyListener from '../../functions/taskrouterListeners/postSurveyListener.private';
import * as postSurveyInit from '../../functions/postSurveyInit';
import { AseloCustomChannels } from '../../functions/helpers/customChannels/customChannelToFlex.private';

const functions = {
  postSurveyInit: {
    path: '../postSurveyInit',
  },
  'helpers/customChannels/customChannelToFlex': {
    path: '../helpers/customChannels/customChannelToFlex.private.ts',
  },
};
global.Runtime.getFunctions = () => functions;

jest.mock('../../functions/postSurveyInit');

// const mockFeatureFlags = {};
// const mockFetchConfig = jest.fn(() => ({ attributes: { feature_flags: mockFeatureFlags } }));
const mockFetchConfig = jest.fn();
const context = {
  ...mock<Context<postSurveyListener.EnvVars>>(),
  getTwilioClient: (): any => ({
    flexApi: {
      configuration: {
        get: () => ({
          fetch: mockFetchConfig,
        }),
      },
    },
  }),
  TWILIO_WORKSPACE_SID: 'WSxxx',
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('Post survey init', () => {
  // Candidate tasks that should trigger post survey if external conditions are met
  const nonTrasferred = {
    taskSid: 'non-trasferred',
    taskChannelUniqueName: 'chat',
    attributes: { transferMeta: undefined, channelType: 'web' },
  };

  const successfullyTrasferred = {
    taskSid: 'successfully-trasferred',
    taskChannelUniqueName: 'chat',
    attributes: {
      transferMeta: { sidWithTaskControl: 'successfully-trasferred', channelType: 'web' },
    },
  };

  each(
    [
      TASK_CREATED,
      TASK_CANCELED,
      TASK_DELETED,
      TASK_SYSTEM_DELETED,
      TASK_COMPLETED,
      TASK_UPDATED,
    ].flatMap((eventType: string) => [
      { task: nonTrasferred, eventType },
      { task: successfullyTrasferred, eventType },
    ]),
  ).test(
    'Task event type $eventType should not trigger post survey for candidate taskSid $task.taskSid',
    async ({ eventType, task }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: eventType,
        TaskAttributes: JSON.stringify(task.attributes),
        TaskChannelUniqueName: task.taskChannelUniqueName,
        TaskSid: task.taskSid,
      };

      const postSurveyInitHandlerSpy = jest.spyOn(postSurveyInit, 'postSurveyInitHandler');

      await postSurveyListener.handleEvent(context, event);

      expect(mockFetchConfig).not.toHaveBeenCalled();
      expect(postSurveyInitHandlerSpy).not.toHaveBeenCalled();
    },
  );

  each([
    {
      task: {
        ...nonTrasferred,
        taskChannelUniqueName: 'voice',
      },
      rejectReason: 'is not chat task',
    },
    {
      task: {
        ...successfullyTrasferred,
        taskChannelUniqueName: 'chat',
        attributes: {
          ...successfullyTrasferred.attributes,
          transferMeta: { sidWithTaskControl: 'a-different-one' },
        },
      },
      rejectReason: 'does not have task controll (incomplete/rejected transfer)',
    },
    ...Object.values(AseloCustomChannels).map((channelType) => ({
      task: {
        ...nonTrasferred,
        taskChannelUniqueName: 'chat',
        attributes: { ...nonTrasferred.attributes, channelType },
      },
      rejectReason: `is custom channel ${channelType}`,
    })),
    {
      task: nonTrasferred,
      isCandidate: true,
      featureFlags: { enable_post_survey: true, post_survey_serverless_handled: false },
      rejectReason: 'is candidate but post_survey_serverless_handled === false',
    },
    {
      task: nonTrasferred,
      isCandidate: true,
      featureFlags: { enable_post_survey: false, post_survey_serverless_handled: true },
      rejectReason: 'is candidate but enable_post_survey === false',
    },
  ]).test(
    'Task should not trigger post survey because $rejectReason',
    async ({ task, featureFlags, isCandidate }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: TASK_WRAPUP as EventType,
        TaskAttributes: JSON.stringify(task.attributes),
        TaskChannelUniqueName: task.taskChannelUniqueName,
        TaskSid: task.taskSid,
      };

      mockFetchConfig.mockReturnValue({
        attributes: { feature_flags: featureFlags || {} },
      });

      const postSurveyInitHandlerSpy = jest.spyOn(postSurveyInit, 'postSurveyInitHandler');

      await postSurveyListener.handleEvent(context, event);

      // If isCandidate, it will reach service config checks
      if (isCandidate) {
        expect(mockFetchConfig).toHaveBeenCalled();
      } else {
        expect(mockFetchConfig).not.toHaveBeenCalled();
      }
      expect(postSurveyInitHandlerSpy).not.toHaveBeenCalled();
    },
  );

  each([nonTrasferred, successfullyTrasferred].map((task) => ({ task }))).test(
    'Task should trigger post survey for candidate taskSid $task.taskSid',
    async ({ task }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: TASK_WRAPUP as EventType,
        TaskAttributes: JSON.stringify(task.attributes),
        TaskChannelUniqueName: task.taskChannelUniqueName,
        TaskSid: task.taskSid,
      };

      mockFetchConfig.mockReturnValue({
        attributes: {
          feature_flags: { enable_post_survey: true, post_survey_serverless_handled: true },
        },
      });

      const postSurveyInitHandlerSpy = jest
        .spyOn(postSurveyInit, 'postSurveyInitHandler')
        .mockImplementationOnce(async () => {});

      await postSurveyListener.handleEvent(context, event);

      expect(mockFetchConfig).toHaveBeenCalled();
      expect(postSurveyInitHandlerSpy).toHaveBeenCalled();
    },
  );
});
