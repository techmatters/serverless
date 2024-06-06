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

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context } from '@twilio-labs/serverless-runtime-types/types';

import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_WRAPUP,
} from '@tech-matters/serverless-helpers/taskrouter';
import type { TransferMeta } from '../transfer/helpers.private';
import type { PostSurveyInitHandler } from '../postSurveyInit';
import type { AWSCredentials } from '../channelCapture/lexClient.private';
import type { ChannelCaptureHandlers } from '../channelCapture/channelCaptureHandlers.private';

export const eventTypes: EventType[] = [TASK_WRAPUP];

export type EnvVars = AWSCredentials & {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  HRM_STATIC_KEY: string;
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
};

// ================== //
// TODO: unify this code with Flex codebase

const getTaskLanguage = (helplineLanguage: string) => (taskAttributes: { language?: string }) =>
  taskAttributes.language || helplineLanguage;
// ================== //

const isTriggerPostSurvey = (
  eventType: EventType,
  taskChannelUniqueName: string,
  taskAttributes: {
    transferMeta?: TransferMeta;
    isChatCaptureControl?: boolean;
  },
) => {
  if (eventType !== TASK_WRAPUP) return false;

  // Post survey is for chat tasks only. This will change when we introduce voice based post surveys
  if (taskChannelUniqueName !== 'chat') return false;

  const channelCaptureHandlers = require(Runtime.getFunctions()[
    'channelCapture/channelCaptureHandlers'
  ].path) as ChannelCaptureHandlers;

  if (channelCaptureHandlers.isChatCaptureControlTask(taskAttributes)) {
    return false;
  }

  return true;
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const {
      EventType: eventType,
      TaskChannelUniqueName: taskChannelUniqueName,
      TaskSid: taskSid,
      TaskAttributes: taskAttributesString,
    } = event;

    console.log(`===== Executing PostSurveyListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);

    if (isTriggerPostSurvey(eventType, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling post survey trigger...');
      const client = context.getTwilioClient();

      // This task is a candidate to trigger post survey. Check feature flags for the account.
      const serviceConfig = await client.flexApi.configuration.get().fetch();
      const { feature_flags: featureFlags, helplineLanguage } = serviceConfig.attributes;

      if (featureFlags.enable_post_survey) {
        const { channelSid, conversationSid } = taskAttributes;

        const taskLanguage = getTaskLanguage(helplineLanguage)(taskAttributes);

        const handlerPath = Runtime.getFunctions().postSurveyInit.path;
        const postSurveyInitHandler = require(handlerPath)
          .postSurveyInitHandler as PostSurveyInitHandler;

        await postSurveyInitHandler(context, {
          channelSid,
          conversationSid,
          taskSid,
          taskLanguage,
        });

        console.log('Finished handling post survey trigger.');
      }
    }
    console.log('===== PostSurveyListener finished successfully =====');
  } catch (err) {
    console.log('===== PostSurveyListener has failed =====');
    console.log(String(err));
    throw err;
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const postSurveyListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default postSurveyListener;
