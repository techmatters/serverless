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

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';
import axios from 'axios';
import type { ChannelCaptureHandlers } from './channelCapture/channelCaptureHandlers.private';
import type { AWSCredentials } from './channelCapture/lexClient.private';

type EnvVars = AWSCredentials & {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  POST_SURVEY_BOT_CHAT_URL: string;
  HRM_STATIC_KEY: string;
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
};

export type Body = {
  channelSid?: string;
  taskSid?: string;
  taskLanguage?: string;
  request: { cookies: {}; headers: {} };
};

const createSurveyTask = async (
  context: Context<EnvVars>,
  event: Required<Pick<Body, 'channelSid' | 'taskSid'>> & Pick<Body, 'taskLanguage'>,
) => {
  const client = context.getTwilioClient();
  const { channelSid, taskSid, taskLanguage } = event;

  const taskAttributes = {
    isSurveyTask: true,
    channelSid,
    contactTaskId: taskSid,
    conversations: { conversation_id: taskSid },
    language: taskLanguage, // if there's a task language, attach it to the post survey task
  };

  const surveyTask = await client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).tasks.create({
    workflowSid: context.SURVEY_WORKFLOW_SID,
    taskChannel: 'survey',
    attributes: JSON.stringify(taskAttributes),
    timeout: 3600,
  });

  const channel = await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).fetch();

  // Add the surveyTask sid so we can retrieve it just by looking at the channel
  await channel.update({
    attributes: JSON.stringify({
      ...JSON.parse(channel.attributes),
      surveyTaskSid: surveyTask.sid,
    }),
  });

  return surveyTask;
};

const triggerPostSurveyFlow = async (
  context: Context<EnvVars>,
  channelSid: string,
  message: string,
) => {
  const client = context.getTwilioClient();

  /** const messageResult = */
  await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).messages.create({
    body: message,
    xTwilioWebhookEnabled: 'true',
  });

  return client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        filters: ['onMessageSent'],
        method: 'POST',
        url: context.POST_SURVEY_BOT_CHAT_URL,
      },
    });
};

const getTriggerMessage = async (
  event: Pick<Body, 'taskLanguage'>,
  context: Context,
): Promise<string> => {
  // Try to retrieve the triggerMessage for the approapriate language (if any)
  const { taskLanguage } = event;
  if (taskLanguage) {
    try {
      const response = await axios.get(
        `https://${context.DOMAIN_NAME}/translations/${taskLanguage}/postSurveyMessages.json`,
      );
      const translation = response.data;

      console.log('translation', translation);

      if (translation.triggerMessage) return translation.triggerMessage;
    } catch {
      console.error(`Couldn't retrieve triggerMessage translation for ${taskLanguage}`);
    }
  }

  return 'Before you leave, would you be willing to answer a few questions about the service you received today? Please answer Yes or No.';
};

export const postSurveyInitHandler = async (
  context: Context<EnvVars>,
  event: Required<Pick<Body, 'channelSid' | 'taskSid' | 'taskLanguage'>>,
) => {
  const { channelSid, taskSid, taskLanguage } = event;

  const triggerMessage = await getTriggerMessage(event, context);

  const serviceConfig = await context.getTwilioClient().flexApi.configuration.get().fetch();
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { enable_lex } = serviceConfig.attributes.feature_flags;

  if (enable_lex) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const channelCaptureHandlers = require(Runtime.getFunctions()[
      'channelCapture/channelCaptureHandlers'
    ].path) as ChannelCaptureHandlers;

    const result = await channelCaptureHandlers.handleChannelCapture(context, {
      channelSid,
      message: triggerMessage,
      language: taskLanguage,
      botSuffix: 'post_survey',
      triggerType: 'withNextMessage',
      releaseType: 'postSurveyComplete',
      memoryAttribute: 'postSurvey',
      releaseFlag: 'postSuveyComplete',
      additionControlTaskAttributes: JSON.stringify({
        isSurveyTask: true,
        contactTaskId: taskSid,
        conversations: { conversation_id: taskSid },
        language: taskLanguage, // if there's a task language, attach it to the post survey task
      }),
      controlTaskTTL: 3600,
    });

    return result;
  }

  // Else, use legacy post survey
  await createSurveyTask(context, { channelSid, taskSid, taskLanguage });
  await triggerPostSurveyFlow(context, channelSid, triggerMessage);
  return { status: 'success' } as const;
};

export type PostSurveyInitHandler = typeof postSurveyInitHandler;

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('-------- postSurveyInit execution --------');

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { channelSid, taskSid, taskLanguage } = event;

      if (channelSid === undefined) return resolve(error400('channelSid'));
      if (taskSid === undefined) return resolve(error400('taskSid'));
      if (taskLanguage === undefined) return resolve(error400('taskLanguage'));

      const result = await postSurveyInitHandler(context, {
        channelSid,
        taskSid,
        taskLanguage,
      });

      if (result.status === 'failure' && result.validationResult.status === 'invalid') {
        resolve(error400(result.validationResult.error));
        // eslint-disable-next-line consistent-return
        return;
      }

      return resolve(success(JSON.stringify({ message: 'Post survey init OK!' })));
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
