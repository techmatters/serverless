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
  ReleaseTypes,
  TriggerTypes,
} from './channelCaptureHandlers.private';
import type { AWSCredentials } from '../helpers/lexClient.private';

type EnvVars = {
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  HRM_STATIC_KEY: string;
} & AWSCredentials;

export type Body = {
  channelSid: string; // (in Studio Flow, flow.channel.address) The channel to capture
  message: string; // (in Studio Flow, trigger.message.Body) The triggering message
  language: string; // (in Studio Flow, {{trigger.message.ChannelAttributes.pre_engagement_data.language | default: 'en-US'}} )
  botSuffix: string; // (hardcoded in Studio Flow)
  triggerType: TriggerTypes;
  releaseType: ReleaseTypes;
  studioFlowSid?: string; // (in Studio Flow, flow.flow_sid) The Studio Flow sid. Needed to trigger an API type execution once the channel is released.
  memoryAttribute?: string; // where in the task attributes we want to save the bot's memory (allows compatibility for multiple bots)
  releaseFlag?: string; // the flag we want to set true when the channel is released
  additionControlTaskAttributes?: string; // optional attributes to include in the control task, in the string representation of a JSON
  controlTaskTTL?: number;
};

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
    } = event;

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
