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
import type { AWSCredentials, LexClient, LexMemory } from './lexClient.private';
import type { BuildDataObject, PostSurveyData } from '../helpers/hrmDataManipulation.private';
import type {
  BuildSurveyInsightsData,
  OneToManyConfigSpec,
} from '../helpers/insightsService.private';
import {
  ChatChannelSid,
  ConversationSid,
} from '../helpers/customChannels/customChannelToFlex.private';

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
  enableLexV2: boolean;
  userId: string;
  environment: string;
  helplineCode: string;
  botLanguage: string;
  botSuffix: string;
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
      const participants = await channel.participants().list();
      const sortByDateCreated = (a: any, b: any) => (a.dateCreated > b.dateCreated ? 1 : -1);
      const firstParticipant = participants.sort(sortByDateCreated)[0];
      return firstParticipant.sid;
    }
    return channelAttributes.participantSid;
  }

  // If there's no service user, find which is the first one and add it channel attributes (only occurs on first capture)
  if (!channelAttributes.serviceUserIdentity) {
    const members = await channel.members().list();
    const firstMember = members.sort((a, b) => (a.dateCreated > b.dateCreated ? 1 : -1))[0];
    return firstMember.identity;
  }

  return channelAttributes.serviceUserIdentity;
};

const updateChannelWithCapture = async (
  channel: ChannelInstance | ConversationInstance,
  attributes: CapturedChannelAttributes,
) => {
  const {
    enableLexV2,
    userId,
    environment,
    helplineCode,
    botLanguage,
    botSuffix,
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

  const newAttributes = {
    attributes: JSON.stringify({
      ...channelAttributes,
      channel_type: channelType,
      serviceUserIdentity: userIdentityOrParticipantId,
      participantSid: userIdentityOrParticipantId,
      // All of this can be passed as url params to the webhook instead
      capturedChannelAttributes: {
        enableLexV2,
        userId,
        environment,
        helplineCode,
        botLanguage,
        botSuffix,
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
  enableLexV2: boolean;
  environment: string;
  helplineCode: string;
  botLanguage: string;
  botSuffix: string;
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
    enableLexV2,
    userId,
    environment,
    helplineCode,
    botSuffix,
    botLanguage,
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
  const handlerPath = Runtime.getFunctions()['channelCapture/lexClient'].path;
  const lexClient = require(handlerPath) as LexClient;

  // trigger Lex first, in order to reduce the time between the creating the webhook and sending the message
  const lexResult = await lexClient.postText(context, {
    botLanguage,
    botSuffix,
    enableLexV2,
    environment,
    helplineCode,
    inputText,
    userId,
  });

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

  await updateChannelWithCapture(channelOrConversation, {
    enableLexV2,
    userId,
    environment,
    helplineCode,
    botLanguage,
    botSuffix,
    controlTaskSid,
    releaseType,
    studioFlowSid,
    releaseFlag,
    memoryAttribute,
    chatbotCallbackWebhookSid: webhook.sid,
    isConversation,
    channelType,
  });

  // Bubble exception after the channel is updated because capture attributes are needed for the cleanup
  if (lexResult.status === 'failure') {
    throw lexResult.error;
  }

  const { lexResponse, lexVersion } = lexResult;

  let messages: string[] = [];
  if (lexVersion === 'v1') {
    messages.push(lexResponse.message || '');
  } else if (lexVersion === 'v2') {
    if (!lexResponse.messages) {
      throw new Error('Lex response does not includes messages');
    }
    messages = messages.concat(lexResponse.messages.map((m) => m.content || ''));
  }

  for (const message of messages) {
    if (isConversation) {
      // eslint-disable-next-line no-await-in-loop
      await (channelOrConversation as ConversationInstance).messages().create({
        body: message,
        author: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await (channelOrConversation as ChannelInstance).messages().create({
        body: message,
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });
    }
  }
};

/**
 * Send a message to the channel and add the chatbot after, so it will get triggered on the next response from the service user (used to trigger executions from system, like post surveys)
 */
const triggerWithNextMessage = async (
  context: Context<EnvVars>,
  channelOrConversation: ChannelInstance | ConversationInstance,
  {
    enableLexV2,
    userId,
    environment,
    helplineCode,
    botLanguage,
    botSuffix,
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
  } else {
    await (channelOrConversation as ChannelInstance).messages().create({
      body: inputText,
      xTwilioWebhookEnabled: 'true',
    });
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
    enableLexV2,
    userId,
    environment,
    helplineCode,
    botLanguage,
    botSuffix,
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

export type HandleChannelCaptureParams = (
  | {
      channelSid: ChatChannelSid;
      conversationSid?: ConversationSid;
    }
  | { conversationSid: ConversationSid; channelSid?: ChatChannelSid }
) & {
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
  channelType: string;
};

type ValidationResult = { status: 'valid' } | { status: 'invalid'; error: string };

const createValidationError = (error: string): ValidationResult => ({ status: 'invalid', error });

const validateHandleChannelCaptureParams = (params: Partial<HandleChannelCaptureParams>) => {
  if (!params.channelSid && !params.conversationSid) {
    return createValidationError('No channelSid or conversationSid provided');
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
  console.log('handleChannelCapture', params);
  const validationResult = validateHandleChannelCaptureParams(params);
  if (validationResult.status === 'invalid') {
    console.error('Invalid params', validationResult.error);
    return { status: 'failure', validationResult } as const;
  }

  const {
    channelSid,
    conversationSid,
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
    channelType,
  } = params as HandleChannelCaptureParams;

  const parsedAdditionalControlTaskAttributes = additionControlTaskAttributes
    ? JSON.parse(additionControlTaskAttributes)
    : {};
  let controlTask: TaskInstance;
  if (conversationSid) {
    const conversationContext = await context
      .getTwilioClient()
      .conversations.v1.conversations(conversationSid);
    // Create control task to prevent channel going stale
    controlTask = await context
      .getTwilioClient()
      .taskrouter.v1.workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.SURVEY_WORKFLOW_SID,
        taskChannel: 'survey',
        attributes: JSON.stringify({
          isChatCaptureControl: true,
          conversationSid,
          ...parsedAdditionalControlTaskAttributes,
        }),
        timeout: controlTaskTTL || 45600, // 720 minutes or 12 hours
      });
    const webhooks = await conversationContext.webhooks.list();
    for (const webhook of webhooks) {
      if (webhook.target === 'studio') {
        // eslint-disable-next-line no-await-in-loop
        await webhook.remove();
      }
    }
  } else {
    [, controlTask] = await Promise.all([
      // Remove the studio trigger webhooks to prevent this channel to trigger subsequent Studio flows executions
      context
        .getTwilioClient()
        .chat.v2.services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .webhooks.list()
        .then((webhooks) =>
          webhooks.map(async (w) => {
            if (w.type === 'studio') {
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
            conversationSid,
            ...parsedAdditionalControlTaskAttributes,
          }),
          timeout: controlTaskTTL || 45600, // 720 minutes or 12 hours
        }),
    ]);
  }

  const { ENVIRONMENT, HELPLINE_CODE } = context;
  let languageSanitized = language.replace('-', '_'); // Lex doesn't accept '-'

  // This is used to match all digits (0-9) and replace them with no space since Lex doesn't accept numbers
  if (/\d/.test(languageSanitized)) {
    languageSanitized = languageSanitized.replace(/\d/g, '');
  }

  const client = context.getTwilioClient();

  const channelOrConversation: ChannelInstance | ConversationInstance = conversationSid
    ? await client.conversations.conversations(conversationSid).fetch()
    : await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).fetch();

  const serviceConfig = await client.flexApi.configuration.get().fetch();
  const enableLexV2 = Boolean(serviceConfig.attributes.feature_flags.enable_lex_v2);

  const options: CaptureChannelOptions = {
    enableLexV2,
    environment: ENVIRONMENT.toLowerCase(),
    helplineCode: HELPLINE_CODE.toLowerCase(),
    botSuffix,
    botLanguage: languageSanitized.toLowerCase(),
    releaseType,
    studioFlowSid,
    memoryAttribute,
    releaseFlag,
    inputText: message,
    userId: channelOrConversation.sid,
    controlTaskSid: controlTask.sid,
    isConversation: Boolean(conversationSid),
    channelType,
  };
  console.debug(
    `Triggering chatbot, triggerType: ${triggerType}, channel / conversation: ${channelOrConversation.sid}`,
  );
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
  await controlTask.remove();
  const { isConversation } = capturedChannelAttributes;

  if (isConversation) {
    return (channelOrConversation as ConversationInstance).webhooks().create({
      target: 'studio',
      configuration: {
        flowSid: capturedChannelAttributes.studioFlowSid,
      },
    });
  }

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
  // Do NOT use axios.post, it will will clobber the Authorization header! https://github.com/axios/axios/issues/891
  await axios.request({
    method: 'post',
    url: `${hrmBaseUrl}/postSurveys`,
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
