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
import type {
  ChannelInstance,
  ChannelInstanceUpdateOptions,
} from 'twilio/lib/rest/chat/v2/service/channel';
import {
  ConversationInstance,
  ConversationInstanceUpdateOptions,
} from 'twilio/lib/rest/conversations/v1/conversation';
import type { WebhookListInstanceCreateOptions as ChannelWebhookOpts } from 'twilio/lib/rest/chat/v2/service/channel/webhook';
import type { WebhookListInstanceCreateOptions as ConversationWebhookOpts } from 'twilio/lib/rest/conversations/v1/conversation/webhook';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import { MemberInstance } from 'twilio/lib/rest/ipMessaging/v2/service/channel/member';
import { MessageListInstanceCreateOptions as ConversationMessageListInstanceCreateOptions } from 'twilio/lib/rest/conversations/v1/conversation/message';
import { MessageListInstanceCreateOptions as ChannelMessageListInstanceCreateOptions } from 'twilio/lib/rest/chat/v2/service/channel/message';
import type { AWSCredentials, LexClient, LexMemory } from './lexClient.private';
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

const triggerTypes = ['withUserMessage', 'withNextMessage'] as const;
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
  isConversation: boolean;
  channelType: string;
};

export const isChatCaptureControlTask = (taskAttributes: { isChatCaptureControl?: boolean }) =>
  Boolean(taskAttributes.isChatCaptureControl);

/**
 * The following sections captures all the required logic to "handle channel capture" (starting a capture on a chat channel)
 * Capture handlers wrap the logic needed for capturing a channel: updating it's attributes, creating a control task, triggering a chatbot, etc
 */

const getServiceUserIdentityOrParticipantId = async (
  channel: ChannelInstance | ConversationInstance,
  channelAttributes: { [k: string]: string },
): Promise<MemberInstance['identity']> => {
  if (channel instanceof ConversationInstance) {
    if (!channelAttributes.participantSid) {
      console.log('Setting participantSid');
      const conversation = channel;
      const participants = await conversation.participants().list();
      const sortByDateCreated = (a: any, b: any) => (a.dateCreated > b.dateCreated ? 1 : -1);
      const firstParticipant = participants.sort(sortByDateCreated)[0];
      return firstParticipant.sid;
    }
    return channelAttributes.participantSid;
  }

  // If there's no service user, find which is the first one and add it channel attributes (only occurs on first capture)
  if (!channelAttributes.serviceUserIdentity) {
    console.log('Setting serviceUserIdentity');
    const members = await channel.members().list();
    console.log('members: ', JSON.stringify(members));
    const firstMember = members.sort((a, b) => (a.dateCreated > b.dateCreated ? 1 : -1))[0];
    console.log('firstMember: ', JSON.stringify(firstMember));
    return firstMember.identity;
  }

  return channelAttributes.serviceUserIdentity;
};

const updateChannelWithCapture = async (
  channel: ChannelInstance | ConversationInstance,
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
    isConversation,
    channelType,
  } = attributes;

  const channelAttributes = JSON.parse(channel.attributes);

  const userIdentityOrParticipantId = await getServiceUserIdentityOrParticipantId(
    channel,
    channelAttributes,
  );

  console.log('>> final channelType: ', channelType);

  const newAttributes = {
    attributes: JSON.stringify({
      ...channelAttributes,
      channel_type: channelType,
      serviceUserIdentity: userIdentityOrParticipantId,
      participantSid: userIdentityOrParticipantId,
      // All of this can be passed as url params to the webhook instead
      capturedChannelAttributes: {
        userId,
        botName,
        botAlias,
        controlTaskSid,
        chatbotCallbackWebhookSid,
        releaseType,
        isConversation,
        ...(studioFlowSid && { studioFlowSid }),
        ...(releaseFlag && { releaseFlag }),
        ...(memoryAttribute && { memoryAttribute }),
      },
    }),
  };

  if (isConversation) {
    return (channel as ConversationInstance).update(
      newAttributes as ConversationInstanceUpdateOptions,
    );
  }

  return (channel as ChannelInstance).update(newAttributes as ChannelInstanceUpdateOptions);
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
  isConversation: boolean;
  channelType: string;
};

/**
 * Trigger a chatbot execution by redirecting a message that already exists in the channel (used to trigger executions from service user messages)
 */
const triggerWithUserMessage = async (
  context: Context<EnvVars>,
  channelOrConversation: ChannelInstance | ConversationInstance,
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
    isConversation,
    channelType,
  }: CaptureChannelOptions,
) => {
  console.log('>> triggerWithUserMessage 1');
  console.log('>> channelType: ', channelType);
  const handlerPath = Runtime.getFunctions()['channelCapture/lexClient'].path;
  const lexClient = require(handlerPath) as LexClient;

  // trigger Lex first, in order to reduce the time between the creating the webhook and sending the message
  const lexResult = await lexClient.postText(context, {
    botName,
    botAlias,
    userId,
    inputText,
  });
  console.log('>> triggerWithUserMessage 2');

  const channelWebhook: ChannelWebhookOpts = {
    type: 'webhook',
    configuration: {
      filters: ['onMessageSent'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/channelCapture/chatbotCallback`,
    },
  };

  const conversationWebhook: ConversationWebhookOpts = {
    target: 'webhook',
    configuration: {
      filters: ['onMessageAdded'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/channelCapture/chatbotCallback`,
    },
  };

  let webhook;
  if (isConversation) {
    webhook = await (channelOrConversation as ConversationInstance)
      .webhooks()
      .create(conversationWebhook);
    console.log('>> created conversation webhook: ');
  } else {
    webhook = await (channelOrConversation as ChannelInstance).webhooks().create(channelWebhook);
    console.log('>> created programmable chat webhook: ');
  }

  console.log(JSON.stringify(webhook));

  console.log('>> triggerWithUserMessage 3');

  await updateChannelWithCapture(channelOrConversation, {
    userId,
    botName,
    botAlias,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
    chatbotCallbackWebhookSid: webhook.sid,
    isConversation,
    channelType,
  });
  console.log('>> triggerWithUserMessage 4');

  // Bubble exception after the channel is updated because capture attributes are needed for the cleanup
  if (lexResult.status === 'failure') {
    throw lexResult.error;
  }

  const { lexResponse } = lexResult;

  const conversationMessage: ConversationMessageListInstanceCreateOptions = {
    body: lexResponse.message,
    author: 'Bot',
    xTwilioWebhookEnabled: 'true',
  };

  const channelMessage: ChannelMessageListInstanceCreateOptions = {
    body: lexResponse.message,
    from: 'Bot',
    xTwilioWebhookEnabled: 'true',
  };

  if (isConversation) {
    console.log('>> is Conversation');
    console.log({ lexMessage: lexResponse.message, conversation: channelOrConversation.sid });
    await (channelOrConversation as ConversationInstance).messages().create(conversationMessage);
  } else {
    console.log('>> is Programmable Chat');
    console.log({ lexMessage: lexResponse.message, conversation: channelOrConversation.sid });
    await (channelOrConversation as ChannelInstance).messages().create(channelMessage);
  }

  console.log('>> triggerWithUserMessage 5');
};

/**
 * Send a message to the channel and add the chatbot after, so it will get triggered on the next response from the service user (used to trigger executions from system, like post surveys)
 */
const triggerWithNextMessage = async (
  context: Context<EnvVars>,
  channelOrConversation: ChannelInstance | ConversationInstance,
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
    isConversation,
    channelType,
  }: CaptureChannelOptions,
) => {
  if (isConversation) {
    await (channelOrConversation as ConversationInstance).messages().create({
      body: inputText,
      xTwilioWebhookEnabled: 'true',
    });
    console.log('Sending conversation message: ', inputText);
  } else {
    await (channelOrConversation as ChannelInstance).messages().create({
      body: inputText,
      xTwilioWebhookEnabled: 'true',
    });
    console.log('Sending programmable chat message: ', inputText);
  }

  const channelWebhook: ChannelWebhookOpts = {
    type: 'webhook',
    configuration: {
      filters: ['onMessageSent'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/channelCapture/chatbotCallback`,
    },
  };

  const conversationWebhook: ConversationWebhookOpts = {
    target: 'webhook',
    configuration: {
      filters: ['onMessageAdded'],
      method: 'POST',
      url: `https://${context.DOMAIN_NAME}/channelCapture/chatbotCallback`,
    },
  };

  let webhook;
  if (isConversation) {
    webhook = await (channelOrConversation as ConversationInstance)
      .webhooks()
      .create(conversationWebhook);
  } else {
    webhook = await (channelOrConversation as ChannelInstance).webhooks().create(channelWebhook);
  }

  // const updated =
  await updateChannelWithCapture(channelOrConversation, {
    userId,
    botName,
    botAlias,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
    chatbotCallbackWebhookSid: webhook.sid,
    isConversation,
    channelType,
  });
};

export type HandleChannelCaptureParams = {
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
  isConversation: boolean;
  channelType: string;
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
  params: Partial<HandleChannelCaptureParams>,
) => {
  const validationResult = validateHandleChannelCaptureParams(params);
  if (validationResult.status === 'invalid') {
    return { status: 'failure', validationResult } as const;
  }

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
    isConversation,
    channelType,
  } = params as HandleChannelCaptureParams;

  console.log('>> isConversation', isConversation);
  console.log('>> channelType', channelType);

  const parsedAdditionalControlTaskAttributes = additionControlTaskAttributes
    ? JSON.parse(additionControlTaskAttributes)
    : {};

  const [, , controlTask] = await Promise.all([
    // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
    !isConversation &&
      context
        .getTwilioClient()
        .chat.services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .webhooks.list()
        .then((channelWebhooks) =>
          channelWebhooks.map(async (w) => {
            if (w.type === 'studio') {
              await w.remove();
            }
          }),
        ),

    /*
     * Doing the "same" as above but for Conversations. Differences to the Studio Webhook in this case:
     * - It's NOT found under the channel webhooks, but under the conversation webhooks
     * - It uses the property 'target' instead of 'type'
     */
    isConversation &&
      context
        .getTwilioClient()
        .conversations.v1.conversations(channelSid)
        .webhooks.list()
        .then((channelWebhooks) =>
          channelWebhooks.map(async (w) => {
            if (w.target === 'studio') {
              await w.remove();
            }
          }),
        ),

    // Create control task to prevent channel going stale
    context
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
      }),
  ]);

  const { ENVIRONMENT, HELPLINE_CODE } = context;
  let languageSanitized = language.replace('-', '_'); // Lex doesn't accept '-'

  // This is used to match all digits (0-9) and replace them with no space since Lex doesn't accept numbers
  if (/\d/.test(languageSanitized)) {
    languageSanitized = languageSanitized.replace(/\d/g, '');
  }

  const botName = `${ENVIRONMENT}_${HELPLINE_CODE.toLowerCase()}_${languageSanitized}_${botSuffix}`;

  const channelOrConversation: ChannelInstance | ConversationInstance = isConversation
    ? await context.getTwilioClient().conversations.v1.conversations(channelSid).fetch()
    : await context
        .getTwilioClient()
        .chat.v2.services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .fetch();

  const options: CaptureChannelOptions = {
    botName,
    botAlias: 'latest', // Assume we always use the latest published version
    releaseType,
    studioFlowSid,
    memoryAttribute,
    releaseFlag,
    inputText: message,
    userId: channelOrConversation.sid,
    controlTaskSid: controlTask.sid,
    isConversation,
    channelType,
  };

  console.log({ message, triggerType, isConversation });
  if (triggerType === 'withUserMessage') {
    await triggerWithUserMessage(context, channelOrConversation, options);
  }

  if (triggerType === 'withNextMessage') {
    await triggerWithNextMessage(context, channelOrConversation, options);
  }

  return { status: 'success' } as const;
};

/**
 * The following sections captures all the required logic to "handle channel release" (releasing a chat channel that was captured)
 * Release handlers wrap the logic needed for releasing a channel: updating it's attributes, removing the control task, redirecting a channel into a Studio Flow, saving data gathered by the bot in HRM/insights, etc
 */

const createStudioFlowTrigger = async (
  channelOrConversation: ChannelInstance | ConversationInstance,
  capturedChannelAttributes: CapturedChannelAttributes,
  controlTask: TaskInstance,
) => {
  // Canceling tasks triggers janitor (see functions/taskrouterListeners/janitorListener.private.ts), so we remove this one since is not needed
  controlTask.remove();
  const { isConversation } = capturedChannelAttributes;
  console.log('>> isConversation', isConversation);

  if (isConversation) {
    console.log('>> create conversation webhook');
    return (channelOrConversation as ConversationInstance).webhooks().create({
      target: 'studio',
      configuration: {
        flowSid: capturedChannelAttributes.studioFlowSid,
      },
    });
  }

  console.log('>> create channel webhook');
  return (channelOrConversation as ChannelInstance).webhooks().create({
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

  await axios.post(`${hrmBaseUrl}/postSurveys`, {
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
    console.info(`Error accessing to the post survey form definitions: ${errorMEssage}`);
  }
};

export const handleChannelRelease = async (
  context: Context<EnvVars>,
  channelOrConversation: ChannelInstance | ConversationInstance,
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
    await createStudioFlowTrigger(channelOrConversation, capturedChannelAttributes, controlTask);
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
