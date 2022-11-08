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

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  POST_SURVEY_BOT_CHAT_URL: string;
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
    timeout: 120,
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

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('-------- postSurveyInit execution --------');

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { channelSid, taskSid, taskLanguage } = event;

    try {
      if (channelSid === undefined) return resolve(error400('channelSid'));
      if (taskSid === undefined) return resolve(error400('taskSid'));

      const triggerMessage = getTriggerMessage(event);

      await createSurveyTask(context, { channelSid, taskSid, taskLanguage });
      await triggerPostSurveyFlow(context, channelSid, triggerMessage);

      return resolve(success(JSON.stringify({ message: 'Post survey init OK!' })));
    } catch (err: any) {
      return resolve(error500(err));
    }
  },
);
