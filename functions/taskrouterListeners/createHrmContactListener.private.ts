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
  EventFields,
  EventType,
  RESERVATION_ACCEPTED,
  TaskrouterListener,
} from '@tech-matters/serverless-helpers/taskrouter';
import { HrmContact, PrepopulateForm } from '../hrm/prepopulateForm';

export const eventTypes: EventType[] = [RESERVATION_ACCEPTED];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  HRM_STATIC_KEY: string;
};

// Temporarily copied to this repo, will share the flex types when we move them into the same repo

const BLANK_CONTACT: HrmContact = {
  id: '',
  timeOfContact: new Date().toISOString(),
  taskId: null,
  helpline: '',
  rawJson: {
    childInformation: {},
    callerInformation: {},
    caseInformation: {},
    callType: '',
    contactlessTask: {
      channel: 'web',
      date: '',
      time: '',
      createdOnBehalfOf: '',
      helpline: '',
    },
    categories: {},
  },
  channelSid: '',
  serviceSid: '',
  channel: 'default',
  createdBy: '',
  createdAt: '',
  updatedBy: '',
  updatedAt: '',
  queueName: '',
  number: '',
  conversationDuration: 0,
  csamReports: [],
  conversationMedia: [],
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (
  { getTwilioClient, HRM_STATIC_KEY }: Context<EnvVars>,
  event: EventFields,
) => {
  const { TaskAttributes: taskAttributesString, TaskSid: taskSid, WorkerSid: workerSid } = event;
  const taskAttributes = taskAttributesString ? JSON.parse(taskAttributesString) : {};
  const { isContactlessTask, channelSid } = taskAttributes;

  if (isContactlessTask) {
    console.debug(`Task ${taskSid} is a contactless task, skipping contact creation.`);
    return;
  }

  const serviceConfig = await getTwilioClient().flexApi.configuration.get().fetch();

  const {
    definitionVersion,
    hrm_base_url: hrmBaseUrl,
    hrm_api_version: hrmApiVersion,
    form_definitions_version_url: configFormDefinitionsVersionUrl,
    assets_bucket_url: assetsBucketUrl,
    helpline_code: helplineCode,
    channelType,
    customChannelType,
    feature_flags: { enable_backend_hrm_contact_creation: enableBackendHrmContactCreation },
  } = serviceConfig.attributes;
  const formDefinitionsVersionUrl =
    configFormDefinitionsVersionUrl || `${assetsBucketUrl}/form-definitions/${helplineCode}/v1`;
  if (!enableBackendHrmContactCreation) {
    console.debug(
      `enable_backend_hrm_contact_creation is not set, the contact associated with task ${taskSid} will be created from Flex.`,
    );
    return;
  }
  console.debug('Creating HRM contact for task', taskSid);
  const hrmBaseAccountUrl = `${hrmBaseUrl}/${hrmApiVersion}/accounts/${serviceConfig.accountSid}`;

  const contactForApi: HrmContact = {
    ...BLANK_CONTACT,
    channel: (customChannelType || channelType) as HrmContact['channel'],
    rawJson: {
      definitionVersion,
      ...BLANK_CONTACT.rawJson,
    },
    twilioWorkerId: workerSid as HrmContact['twilioWorkerId'],
    taskId: taskSid as HrmContact['taskId'],
    channelSid: channelSid ?? '',
    serviceSid: (channelSid && serviceConfig.chatServiceInstanceSid) ?? '',
  };

  const prepopulatePath = Runtime.getFunctions()['hrm/prepopulateForm'].path;
  const { prepopulateForm } = require(prepopulatePath) as PrepopulateForm;
  await prepopulateForm(taskAttributes, contactForApi, formDefinitionsVersionUrl);
  const options: RequestInit = {
    method: 'POST',
    body: JSON.stringify(contactForApi),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${HRM_STATIC_KEY}`,
    },
  };
  const response = await fetch(`${hrmBaseAccountUrl}/contacts`, options);
  const { id }: HrmContact = await response.json();
  console.info(`Created HRM contact with id ${id} for task ${taskSid}`);
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const transfersListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default transfersListener;
