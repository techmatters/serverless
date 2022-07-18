import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  POST_SURVEY_BOT_CHAT_URL: string;
  SYNC_SERVICE_SID: string;
};

export type ChatBody = {
  eventType: 'chat';
  channelSid: string;
  taskSid: string;
  taskLanguage?: string;
};

export type VoiceBody = {
  eventType: 'voice';
  callerAddress: string;
  taskSid: string;
  taskLanguage?: string;
};

export type Body = ChatBody | VoiceBody;

const createSurveyTask = async (context: Context<EnvVars>, event: Body) => {
  const client = context.getTwilioClient();

  if (event.eventType === 'chat') {
    const { channelSid, taskSid } = event;

    const taskAttributes = {
      isSurveyTask: true,
      channelSid,
      contactTaskId: taskSid,
      conversations: { conversation_id: taskSid },
    };

    const surveyTask = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.SURVEY_WORKFLOW_SID,
        taskChannel: 'survey',
        attributes: JSON.stringify(taskAttributes),
        timeout: 120,
      });

    const channel = await client.chat
      .services(context.CHAT_SERVICE_SID)
      .channels(channelSid)
      .fetch();

    // Add the surveyTask sid so we can retrieve it just by looking at the channel
    await channel.update({
      attributes: JSON.stringify({
        ...JSON.parse(channel.attributes),
        surveyTaskSid: surveyTask.sid,
      }),
    });

    return surveyTask;
  }

  if (event.eventType === 'voice') {
    const { callerAddress, taskSid } = event;

    const taskAttributes = {
      isSurveyTask: true,
      callerAddress,
      contactTaskId: taskSid,
      conversations: { conversation_id: taskSid },
    };

    const surveyTask = await client.taskrouter
      .workspaces(context.TWILIO_WORKSPACE_SID)
      .tasks.create({
        workflowSid: context.SURVEY_WORKFLOW_SID,
        taskChannel: 'survey',
        attributes: JSON.stringify(taskAttributes),
        timeout: 120,
      });

    // Add the surveyTask sid to a sync document we can retrieve it just by callerAddress
    await context
      .getTwilioClient()
      .sync.services(context.SYNC_SERVICE_SID)
      .documents.create({
        data: { surveyTaskSid: surveyTask.sid },
        uniqueName: `pending-voice-post-survey-${callerAddress}`,
        ttl: 86400, // auto removed after 24 hours
      });

    return surveyTask;
  }

  return `Reached unhandled case with event ${event}`;
};

const triggerPostSurveyFlow = async (
  context: Context<EnvVars>,
  channelSid: string,
  message: string,
) => {
  const client = context.getTwilioClient();

  /** const messageResult = */
  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .messages.create({
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

const getTriggerMessage = (event: Body): string => {
  // Try to retrieve the triggerMessage for the approapriate language (if any)
  const { taskLanguage } = event;
  if (taskLanguage) {
    try {
      const translation = JSON.parse(
        Runtime.getAssets()[`/translations/${taskLanguage}/postSurveyMessages.json`].open(),
      );

      if (translation.triggerMessage) return translation.triggerMessage;
    } catch {
      console.error(`Couldn't retrieve triggerMessage translation for ${taskLanguage}`);
    }
  }

  return 'Before you leave, would you be willing to answer a few questions about the service you received today? Please answer Yes or No.';
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('-------- postSurveyInit execution --------');

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      if (event.eventType === 'chat') {
        const { channelSid, taskSid } = event;

        if (channelSid === undefined) return resolve(error400('channelSid'));
        if (taskSid === undefined) return resolve(error400('taskSid'));

        const triggerMessage = getTriggerMessage(event);

        await createSurveyTask(context, event);
        await triggerPostSurveyFlow(context, channelSid, triggerMessage);
      }

      if (event.eventType === 'voice') {
        const { callerAddress, taskSid } = event;

        if (callerAddress === undefined) return resolve(error400('channelSid'));
        if (taskSid === undefined) return resolve(error400('taskSid'));

        await createSurveyTask(context, event);
      }

      return resolve(success(JSON.stringify({ message: 'Post survey init OK!' })));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
