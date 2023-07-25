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
import helpers from '../helpers';

jest.mock('../../functions/postSurveyInit');

const defaultFeatureFlags = { enable_lex: false }; // Just give compatibility for legacy tests for now. TODO: add tests for the new schema

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
  flexApi: {
    configuration: () => ({
      get: () => ({
        fetch: () => ({
          serviceConfig: {
            attributes: {
              feature_flags: defaultFeatureFlags,
            },
          },
        }),
      }),
    }),
  },
  TWILIO_WORKSPACE_SID: 'WSxxx',
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime(context);
  runtime._addFunction('postSurveyInit', 'functions/postSurveyInit');
  runtime._addFunction(
    'helpers/customChannels/customChannelToFlex',
    'functions/helpers/customChannels/customChannelToFlex.private',
  );
  runtime._addFunction(
    'channelCapture/channelCaptureHandlers',
    'functions/channelCapture/channelCaptureHandlers.private',
  );
  helpers.setup({}, runtime);
});
afterAll(() => {
  helpers.teardown();
});

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
      featureFlags: { enable_post_survey: true },
      rejectReason: 'is candidate with enable_post_survey === true',
    },
    {
      task: nonTrasferred,
      isCandidate: true,
      featureFlags: { enable_post_survey: false },
      rejectReason: 'is candidate but enable_post_survey === false',
    },
  ]).test(
    'Task should not trigger post survey because $rejectReason',
    async ({ task, featureFlags }) => {
      const event = {
        ...mock<EventFields>(),
        EventType: TASK_WRAPUP as EventType,
        TaskAttributes: JSON.stringify(task.attributes),
        TaskChannelUniqueName: task.taskChannelUniqueName,
        TaskSid: task.taskSid,
      };

      mockFetchConfig.mockReturnValue({
        attributes: { feature_flags: { ...defaultFeatureFlags, ...(featureFlags || {}) } },
      });

      const postSurveyInitHandlerSpy = jest.spyOn(postSurveyInit, 'postSurveyInitHandler');

      await postSurveyListener.handleEvent(context, event);

      if (featureFlags && featureFlags.enable_post_survey) {
        expect(postSurveyInitHandlerSpy).toHaveBeenCalled();
      } else {
        expect(postSurveyInitHandlerSpy).not.toHaveBeenCalled();
      }
    },
  );

  each([
    { task: nonTrasferred },
    { task: successfullyTrasferred },
    {
      task: {
        ...successfullyTrasferred,
        taskChannelUniqueName: 'chat',
        attributes: {
          ...successfullyTrasferred.attributes,
          transferMeta: { sidWithTaskControl: 'a-different-one' },
        },
      },
      extraDescription: 'even if does not have task control (in progress/rejected transfer)',
    },
  ]).test(
    'Task should trigger post survey for candidate taskSid $task.taskSid $extraDescription',
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
          feature_flags: { enable_post_survey: true },
        },
      });

      const postSurveyInitHandlerSpy = jest
        .spyOn(postSurveyInit, 'postSurveyInitHandler')
        .mockImplementationOnce(async () => ({} as any));

      await postSurveyListener.handleEvent(context, event);

      expect(mockFetchConfig).toHaveBeenCalled();
      expect(postSurveyInitHandlerSpy).toHaveBeenCalled();
    },
  );
});
