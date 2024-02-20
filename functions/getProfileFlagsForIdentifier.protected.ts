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

/* eslint-disable no-console */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import {
  bindResolve,
  error500,
  responseWithCors,
  send,
  success,
} from '@tech-matters/serverless-helpers';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
// We use axios instead of node-fetch in this repo because the later one raises a run time error when trying to import it. The error is related to how JS modules are loaded.
import axios from 'axios';

type ChatTrigger = {
  message: {
    ChannelAttributes: {
      pre_engagement_data?: {
        contactIdentifier: string;
      };
      from: string;
      channel_type: string;
    };
  };
};
const isChatTrigger = (obj: any): obj is ChatTrigger =>
  obj && obj.message && typeof obj.message === 'object';

type VoiceTrigger = {
  call: {
    From: string;
    Caller: string;
  };
};
const isVoiceTrigger = (obj: any): obj is VoiceTrigger =>
  obj && obj.call && typeof obj.call === 'object';

export type Event = {
  trigger: ChatTrigger | VoiceTrigger;
  request: { cookies: {}; headers: {} };
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  HRM_STATIC_KEY: string;
};

const getContactValueFromWebchat = (trigger: ChatTrigger) => {
  const preEngagementData = trigger.message.ChannelAttributes.pre_engagement_data;
  if (!preEngagementData) return '';
  return preEngagementData.contactIdentifier;
};

export const getIdentifier = (trigger: Event['trigger']) => {
  if (isVoiceTrigger(trigger)) {
    return trigger.call.From;
  }

  if (isChatTrigger(trigger)) {
    if (trigger.message.ChannelAttributes.channel_type === 'facebook') {
      return trigger.message.ChannelAttributes.from.replace('messenger:', '');
    }
    if (trigger.message.ChannelAttributes.channel_type === 'whatsapp') {
      return trigger.message.ChannelAttributes.from.replace('whatsapp:', '');
    }
    if (trigger.message.ChannelAttributes.channel_type === 'modica') {
      return trigger.message.ChannelAttributes.from.replace('modica:', '');
    }
    if (trigger.message.ChannelAttributes.channel_type === 'web') {
      return getContactValueFromWebchat(trigger);
    }

    return trigger.message.ChannelAttributes.from;
  }

  throw new Error('Trigger is none VoiceTrigger nor ChatTrigger');
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const client = context.getTwilioClient();
    const serviceConfig = await client.flexApi.configuration.get().fetch();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { hrm_base_url, hrm_api_version } = serviceConfig.attributes;
    const hrmBaseUrl = `${hrm_base_url}/${hrm_api_version}/accounts/${serviceConfig.accountSid}`;
    const { trigger } = event;

    const identifier = getIdentifier(trigger);
    const res = await axios({
      url: `${hrmBaseUrl}/profiles/identifier/${identifier}/flags`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${context.HRM_STATIC_KEY}`,
      },
      validateStatus: () => true, // don't throw on "failure" status codes
    });

    if (res.status !== 200) {
      resolve(send(res.status)(res.data));
      return;
    }

    console.log(res.data);
    resolve(success({ flags: res.data.map((flag: { name: string }) => flag.name) })); // return a list with the flags' names only
  } catch (err: any) {
    resolve(error500(err));
  }
};
