/* eslint-disable global-require */
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
import axios from 'axios';
import type { Context } from '@twilio-labs/serverless-runtime-types/types';
import type { ChannelInstance } from 'twilio/lib/rest/chat/v2/service/channel';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import type { AWSCredentials, LexClient, LexMemory } from '../helpers/lexClient.private';
import type { BuildDataObject, PostSurveyData } from '../helpers/hrmDataManipulation.private';
import type {
  BuildSurveyInsightsData,
  OneToManyConfigSpec,
} from '../helpers/insightsService.private';

type EnvVars = AWSCredentials & {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  HRM_STATIC_KEY: string;
  HELPLINE_CODE: string;
  ENVIRONMENT: string;
  SURVEY_WORKFLOW_SID: string;
};

const triggerTypes = ['redirectMessage', 'onNextMessage'] as const;
export type TriggerTypes = typeof triggerTypes[number];

const releaseTypes = ['triggerStudioFlow', 'postSurveyComplete'] as const;
export type ReleaseTypes = typeof releaseTypes[number];

export type CapturedChannelAttributes = {
  userId: string;
  botName: string;
  botAlias: string;
  controlTaskSid: string;
  releaseType: ReleaseTypes;
  studioFlowSid?: string;
  memoryAttribute?: string;
  releaseFlag?: string;
  chatbotCallbackWebhookSid: string;
};

export const isChatCaptureControlTask = (taskAttributes: { isChatCaptureControl?: boolean }) =>
  Boolean(taskAttributes.isChatCaptureControl);

/**
 * The following sections captures all the required logic to "handle channel capture" (starting a capture on a chat channel)
 * Capture handlers wrap the logic needed for capturing a channel: updating it's attributes, creating a control task, triggering a chatbot, etc
 */

const updateChannelWithCapture = (
  channel: ChannelInstance,
  attributes: CapturedChannelAttributes,
) => {
  const {
    userId,
    botName,
    botAlias,
    controlTaskSid,
    chatbotCallbackWebhookSid,
    releaseType,
    studioFlowSid,
    memoryAttribute,
    releaseFlag,
  } = attributes;
  const channelAttributes = JSON.parse(channel.attributes);

  return channel.update({
    attributes: JSON.stringify({
      ...channelAttributes,
      // All of this can be passed as url params to the webhook instead
      capturedChannelAttributes: {
        userId,
        botName,
        botAlias,
        controlTaskSid,
        chatbotCallbackWebhookSid,
        releaseType,
        ...(studioFlowSid && { studioFlowSid }),
        ...(releaseFlag && { releaseFlag }),
        ...(memoryAttribute && { memoryAttribute }),
      },
    }),
  });
};

type CaptureChannelOptions = {
  botName: string;
  botAlias: string;
  inputText: string;
  userId: string;
  controlTaskSid: string;
  releaseType: ReleaseTypes;
  studioFlowSid?: string; // (in Studio Flow, flow.flow_sid) The Studio Flow sid. Needed to trigger an API type execution once the channel is released.
  memoryAttribute?: string; // where in the task attributes we want to save the bot's memory (allows compatibility for multiple bots)
  releaseFlag?: string; // the flag we want to set true when the channel is released
};

/**
 * Trigger a chatbot execution by redirecting a message that already exists in the channel (used to trigger executions from service user messages)
 */
const triggerRedirectingMessage = async (
  context: Context<EnvVars>,
  channel: ChannelInstance,
  {
    userId,
    botName,
    botAlias,
    inputText,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
  }: CaptureChannelOptions,
) => {
  const chatbotCallbackWebhook = await channel.webhooks().create({
    type: 'webhook',
    configuration: {
      filters: ['onMessageSent'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/channelCapture/chatbotCallback`,
    },
  });

  // const updated =
  await updateChannelWithCapture(channel, {
    userId,
    botName,
    botAlias,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
    chatbotCallbackWebhookSid: chatbotCallbackWebhook.sid,
  });

  const handlerPath = Runtime.getFunctions()['helpers/lexClient'].path;
  const lexClient = require(handlerPath) as LexClient;

  const lexResponse = await lexClient.postText(context, {
    botName,
    botAlias,
    userId,
    inputText,
  });

  // Send message to trigger the recently created chatbot integration
  await channel.messages().create({
    body: lexResponse.message,
    from: 'Bot',
    xTwilioWebhookEnabled: 'true',
  });
};

/**
 * Send a message to the channel and add the chatbot after, so it will get triggered on the next response from the service user (used to trigger executions from system, like post surveys)
 */
const triggerOnNextMessage = async (
  context: Context<EnvVars>,
  channel: ChannelInstance,
  {
    userId,
    botName,
    botAlias,
    inputText,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
  }: CaptureChannelOptions,
) => {
  /** const messageResult = */
  await channel.messages().create({
    body: inputText,
    xTwilioWebhookEnabled: 'true',
  });

  const chatbotCallbackWebhook = await channel.webhooks().create({
    type: 'webhook',
    configuration: {
      filters: ['onMessageSent'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/webhooks/chatbotCallback`,
    },
  });

  // const updated =
  await updateChannelWithCapture(channel, {
    userId,
    botName,
    botAlias,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
    chatbotCallbackWebhookSid: chatbotCallbackWebhook.sid,
  });
};

type HandleChannelCaptureParams = {
  channelSid: string; // The channel to capture (in Studio Flow, flow.channel.address)
  message: string; // The triggering message (in Studio Flow, trigger.message.Body)
  language: string; // (in Studio Flow, {{trigger.message.ChannelAttributes.pre_engagement_data.language | default: 'en-US'}} )
  botSuffix: string;
  triggerType: TriggerTypes;
  releaseType: ReleaseTypes;
  studioFlowSid?: string; // The Studio Flow sid. Needed to trigger an API type execution once the channel is released. (in Studio Flow, flow.flow_sid)
  memoryAttribute?: string; // Where in the channel attributes we want to save the bot's memory (allows usage of multiple bots in same channel)
  releaseFlag?: string; // The flag we want to set true in the channel attributes when the channel is released
  additionControlTaskAttributes?: string; // Optional attributes to include in the control task, in the string representation of a JSON
  controlTaskTTL?: number;
};

type ValidationResult = { status: 'valid' } | { status: 'invalid'; error: string };

const createValidationError = (error: string): ValidationResult => ({ status: 'invalid', error });

const validateHandleChannelCaptureParams = (params: Partial<HandleChannelCaptureParams>) => {
  if (!params.channelSid) {
    return createValidationError('Missing channelSid');
  }
  if (!params.message) {
    return createValidationError('Missing message');
  }
  if (!params.triggerType) {
    return createValidationError('Missing triggerType');
  }
  if (!triggerTypes.includes(params.triggerType)) {
    return createValidationError(`triggerType must be one of: ${triggerTypes.join(', ')}`);
  }
  if (!params.releaseType) {
    return createValidationError('Missing releaseType');
  }
  if (!releaseTypes.includes(params.releaseType)) {
    return createValidationError(`releaseType must be one of: ${releaseTypes.join(', ')}`);
  }
  if (params.releaseType === 'triggerStudioFlow' && !params.studioFlowSid) {
    return createValidationError(
      'studioFlowSid must provided when releaseType is triggerStudioFlow',
    );
  }
  if (!params.botSuffix) {
    return createValidationError('botSuffix');
  }
  if (!params.language) {
    return createValidationError('language');
  }

  return { status: 'valid' } as const;
};

export const handleChannelCapture = async (
  context: Context<EnvVars>,
  params: HandleChannelCaptureParams,
) => {
  const {
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
  } = params;
  const validationResult = validateHandleChannelCaptureParams(params);
  if (validationResult.status === 'invalid') {
    return { status: 'failure', validationResult } as const;
  }

  const parsedAdditionalControlTaskAttributes = additionControlTaskAttributes
    ? JSON.parse(additionControlTaskAttributes)
    : {};

  const channel = await context
    .getTwilioClient()
    .chat.v2.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .fetch();

  const channelWebhooks = await context
    .getTwilioClient()
    .chat.services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .webhooks.list();

  // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
  await Promise.all(
    channelWebhooks.map(async (w) => {
      if (w.type === 'studio') {
        await w.remove();
      }
    }),
  );

  const { ENVIRONMENT, HELPLINE_CODE } = context;
  const languageSanitized = language.replace('-', '_'); // Lex doesn't accept '-'
  const botName = `${ENVIRONMENT}_${HELPLINE_CODE.toLowerCase()}_${languageSanitized}_${botSuffix}`;

  // Create control task to prevent channel going stale
  const controlTask = await context
    .getTwilioClient()
    .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks.create({
      workflowSid: context.SURVEY_WORKFLOW_SID,
      taskChannel: 'survey',
      attributes: JSON.stringify({
        isChatCaptureControl: true,
        channelSid,
        ...parsedAdditionalControlTaskAttributes,
      }),
      timeout: controlTaskTTL || 45600, // 720 minutes or 12 hours
    });

  // If there's no service user, find which is the first one and add it channel attributes (only occurs on first capture)
  const channelAttributes = JSON.parse(channel.attributes);
  if (!channelAttributes.fromServiceUser) {
    const members = await channel.members().list();
    const firstMember = members.sort((a, b) => (a.dateCreated > b.dateCreated ? 1 : -1))[0];
    await channel.update({
      attributes: { ...channelAttributes, fromServiceUser: firstMember.identity },
    });
  }

  const options: CaptureChannelOptions = {
    botName,
    botAlias: 'latest', // Assume we always use the latest published version
    releaseType,
    studioFlowSid,
    memoryAttribute,
    releaseFlag,
    inputText: message,
    userId: channel.sid,
    controlTaskSid: controlTask.sid,
  };

  if (triggerType === 'redirectMessage') {
    await triggerRedirectingMessage(context, channel, options);
  }

  if (triggerType === 'onNextMessage') {
    await triggerOnNextMessage(context, channel, options);
  }

  return { status: 'success' } as const;
};

/**
 * The following sections captures all the required logic to "handle channel release" (releasing a chat channel that was captured)
 * Release handlers wrap the logic needed for releasing a channel: updating it's attributes, removing the control task, redirecting a channel into a Studio Flow, saving data gathered by the bot in HRM/insights, etc
 */

const createStudioFlowTrigger = async (
  channel: ChannelInstance,
  capturedChannelAttributes: CapturedChannelAttributes,
  controlTask: TaskInstance,
) => {
  // Canceling tasks triggers janitor (see functions/taskrouterListeners/janitorListener.private.ts), so we remove this one since is not needed
  controlTask.remove();

  return channel.webhooks().create({
    type: 'studio',
    configuration: {
      flowSid: capturedChannelAttributes.studioFlowSid,
    },
  });
};

type PostSurveyBody = {
  contactTaskId: string;
  taskId: string;
  data: PostSurveyData;
};

const saveSurveyInInsights = async (
  postSurveyConfigJson: OneToManyConfigSpec[],
  memory: LexMemory,
  controlTask: TaskInstance,
  controlTaskAttributes: any,
) => {
  const handlerPath = Runtime.getFunctions()['helpers/insightsService'].path;
  const buildSurveyInsightsData = require(handlerPath)
    .buildSurveyInsightsData as BuildSurveyInsightsData;

  const finalAttributes = buildSurveyInsightsData(
    postSurveyConfigJson,
    controlTaskAttributes,
    memory,
  );

  await controlTask.update({ attributes: JSON.stringify(finalAttributes) });
};

const saveSurveyInHRM = async (
  postSurveyConfigJson: OneToManyConfigSpec[],
  memory: LexMemory,
  controlTask: TaskInstance,
  controlTaskAttributes: any,
  hrmBaseUrl: string,
  hrmStaticKey: string,
) => {
  const handlerPath = Runtime.getFunctions()['helpers/hrmDataManipulation'].path;
  const buildDataObject = require(handlerPath).buildDataObject as BuildDataObject;

  const data = buildDataObject(postSurveyConfigJson, memory);

  const body: PostSurveyBody = {
    contactTaskId: controlTaskAttributes.contactTaskId,
    taskId: controlTask.sid,
    data,
  };

  await axios({
    url: `${hrmBaseUrl}/postSurveys`,
    method: 'POST',
    data: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${hrmStaticKey}`,
    },
  });
};

const handlePostSurveyComplete = async (
  context: Context<EnvVars>,
  memory: LexMemory,
  controlTask: TaskInstance,
) => {
  const client = context.getTwilioClient();

  // get the postSurvey definition
  const serviceConfig = await client.flexApi.configuration.get().fetch();

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { definitionVersion, hrm_base_url, hrm_api_version } = serviceConfig.attributes;
  const postSurveyConfigJson =
    Runtime.getAssets()[`/formDefinitions/${definitionVersion}/insights/postSurvey.json`];
  const hrmBaseUrl = `${hrm_base_url}/${hrm_api_version}/accounts/${serviceConfig.accountSid}`;

  if (definitionVersion && postSurveyConfigJson && postSurveyConfigJson.open) {
    const postSurveyConfigSpecs = JSON.parse(postSurveyConfigJson.open()) as OneToManyConfigSpec[];

    const controlTaskAttributes = JSON.parse(controlTask.attributes);

    // parallel execution to save survey collected data in insights and hrm
    await Promise.all([
      saveSurveyInInsights(postSurveyConfigSpecs, memory, controlTask, controlTaskAttributes),
      saveSurveyInHRM(
        postSurveyConfigSpecs,
        memory,
        controlTask,
        controlTaskAttributes,
        hrmBaseUrl,
        context.HRM_STATIC_KEY,
      ),
    ]);

    // As survey tasks will never be assigned to a worker, they'll be kept in pending state. A pending can't transition to completed state, so we cancel them here to raise a task.canceled taskrouter event (see functions/taskrouterListeners/janitorListener.private.ts)
    // This needs to be the last step so the new task attributes from saveSurveyInInsights make it to insights
    await controlTask.update({ assignmentStatus: 'canceled' });
  } else {
    const errorMEssage =
      // eslint-disable-next-line no-nested-ternary
      !definitionVersion
        ? 'Current definitionVersion is missing in service configuration.'
        : !postSurveyConfigJson
        ? `No postSurveyConfigJson found for definitionVersion ${definitionVersion}.`
        : `postSurveyConfigJson for definitionVersion ${definitionVersion} is not a Twilio asset as expected`; // This should removed when if we move definition versions to an external source.
    console.error(`Error accessing to the post survey form definitions: ${errorMEssage}`);
  }
};

export const handleChannelRelease = async (
  context: Context<EnvVars>,
  channel: ChannelInstance,
  capturedChannelAttributes: CapturedChannelAttributes,
  memory: LexMemory,
) => {
  // get the control task
  const controlTask = await context
    .getTwilioClient()
    .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(capturedChannelAttributes.controlTaskSid)
    .fetch();

  if (capturedChannelAttributes.releaseType === 'triggerStudioFlow') {
    await createStudioFlowTrigger(channel, capturedChannelAttributes, controlTask);
  }

  if (capturedChannelAttributes.releaseType === 'postSurveyComplete') {
    await handlePostSurveyComplete(context, memory, controlTask);
  }
};

export type ChannelCaptureHandlers = {
  isChatCaptureControlTask: typeof isChatCaptureControlTask;
  handleChannelCapture: typeof handleChannelCapture;
  handleChannelRelease: typeof handleChannelRelease;
};
