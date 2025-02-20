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
  trigger: ChatTrigger | VoiceTrigger | ConversationTrigger;
  request: { cookies: {}; headers: {} };
  channelType?: string;
};

type ConversationTrigger = {
  conversation: {
    Author: string;
  };
};

const isConversationTrigger = (obj: any): obj is ConversationTrigger =>
  typeof obj?.conversation === 'object';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  HRM_STATIC_KEY: string;
};

const getContactValueFromWebchat = (trigger: ChatTrigger) => {
  const preEngagementData = trigger.message.ChannelAttributes.pre_engagement_data;
  if (!preEngagementData) return '';
  return preEngagementData.contactIdentifier;
};

/**
 * IMPORTANT: keep up to date with flex-plugins/plugin-hrm-form/src/utils/task
 */
const trimSpaces = (s: string) => s.replaceAll(' ', '');
const trimHyphens = (s: string) => s.replaceAll('-', '');
const phoneNumberStandardization = (s: string) =>
  [trimSpaces, trimHyphens].reduce((accum, f) => f(accum), s);
// If the Aselo Connector is being used, we might get a voice From that looks like
// 'sip:+2601234567@41.52.63.73'. This regexp should normalize the string.
const aseloConnectorNormalization = (s: string) => s.match(/sip:([^@]+)/)?.[1] || s;
type TransformIdentifierFunction = (c: string) => string;
const channelTransformations: { [k: string]: TransformIdentifierFunction[] } = {
  voice: [aseloConnectorNormalization, phoneNumberStandardization],
  sms: [phoneNumberStandardization],
  whatsapp: [(s) => s.replace('whatsapp:', ''), phoneNumberStandardization],
  modica: [(s) => s.replace('modica:', ''), phoneNumberStandardization],
  facebook: [(s) => s.replace('messenger:', '')],
  messenger: [(s) => s.replace('messenger:', '')],
  instagram: [(s) => s.replace('instagram:', '')],
  line: [],
  telegram: [(s) => s.replace('telegram:', '')],
  web: [],
};

export const getIdentifier = (trigger: Event['trigger'], channelType?: string): string => {
  if (isVoiceTrigger(trigger)) {
    return channelTransformations.voice.reduce((accum, f) => f(accum), trigger.call.From);
  }

  if (isChatTrigger(trigger)) {
    // webchat is a special case since it does not only depends on channel but in the task attributes too
    if (trigger.message.ChannelAttributes.channel_type === 'web') {
      return getContactValueFromWebchat(trigger);
    }

    // otherwise, return the "defaultFrom" with the transformations on the identifier corresponding to each channel
    return channelTransformations[trigger.message.ChannelAttributes.channel_type].reduce(
      (accum, f) => f(accum),
      trigger.message.ChannelAttributes.from,
    );
  }

  if (isConversationTrigger(trigger) && channelType) {
    if (!channelTransformations[channelType] || !channelType) {
      console.error(`Channel type ${channelType} is not supported`);
      throw new Error(`Channel type ${channelType} is not supported`);
    }
    return channelTransformations[channelType].reduce(
      (accum, f) => f(accum),
      trigger.conversation.Author,
    );
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
    const { trigger, channelType } = event;

    const identifier = getIdentifier(trigger, channelType);
    const res = await axios.request({
      url: `${hrmBaseUrl}/profiles/identifier/${identifier}/flags`,
      method: 'get',
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
