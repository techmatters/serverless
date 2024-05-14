/* eslint-disable import/no-dynamic-require */
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
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';
import type { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import type {
  ChannelCaptureHandlers,
  HandleChannelCaptureParams,
} from './channelCaptureHandlers.private';
import type { AWSCredentials } from './lexClient.private';

type EnvVars = {
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  HRM_STATIC_KEY: string;
} & AWSCredentials;

export type Body = Partial<HandleChannelCaptureParams> & { isConversation: string };

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  console.log('===== captureChannelWithBot handler =====');
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const {
      channelSid,
      message,
      triggerType,
      releaseType,
      studioFlowSid,
      language,
      botSuffix,
      additionControlTaskAttributes,
      controlTaskTTL,
      memoryAttribute,
      releaseFlag,
      isConversation: isConversationString,
      channelType,
    } = event;

    const isConversation = isConversationString === 'true';
    console.log('>> isConversation', isConversation);
    console.log('>> channelType', channelType);

    const handlerPath = Runtime.getFunctions()['channelCapture/channelCaptureHandlers'].path;
    const channelCaptureHandlers = require(handlerPath) as ChannelCaptureHandlers;

    const result = await channelCaptureHandlers.handleChannelCapture(context, {
      channelSid,
      message,
      language,
      botSuffix,
      triggerType,
      releaseType,
      studioFlowSid,
      memoryAttribute,
      releaseFlag,
      additionControlTaskAttributes,
      controlTaskTTL,
      isConversation,
    });

    if (result.status === 'failure' && result.validationResult.status === 'invalid') {
      resolve(error400(result.validationResult.error));
      return;
    }

    resolve(success('Channel captured by bot =)'));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};

export type CaptureChannelWithBot = { handler: typeof handler };
