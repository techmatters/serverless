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
};

export type Body = {
  channelSid?: string;
  taskSid?: string;
};

const createSurveyTask = async (context: Context<EnvVars>, event: Required<Body>) => {
  const client = context.getTwilioClient();
  const { channelSid, taskSid } = event;

  const taskAttributes = {
    isSurveyTask: true,
    channelSid,
    contactTaskId: taskSid,
    conversations: { conversation_id: taskSid },
  };

  const surveyTask = await client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).tasks.create({
    workflowSid: 'WW6a967d8f663083bdb8ae586539fa71d7', // TODO: move this out
    taskChannel: 'survey',
    attributes: JSON.stringify(taskAttributes),
    timeout: 30,
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
};

const triggerPostSurveyFlow = async (context: Context<EnvVars>, channelSid: string) => {
  const client = context.getTwilioClient();

  await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .webhooks.create({
      type: 'webhook',
      configuration: {
        filters: ['onMessageSent'],
        method: 'POST',
        url:
          'https://channels.autopilot.twilio.com/v1/ACd8a2e89748318adf6ddff7df6948deaf/UA59f7eb8ec74c4a18b229f7d6ff5a63ab/twilio-chat', // TODO: move url to env vars (edit deploy scripts needed)
      },
    });

  const messageResult = await client.chat
    .services(context.CHAT_SERVICE_SID)
    .channels(channelSid)
    .messages.create({
      body: 'Hey! Before you leave, can you answer a few questions about this contact?',
      xTwilioWebhookEnabled: 'true',
    });

  return messageResult;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    console.log('-------- postSurveyInit execution --------');

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { channelSid, taskSid } = event;

    try {
      if (channelSid === undefined) return resolve(error400('channelSid'));
      if (taskSid === undefined) return resolve(error400('taskSid'));

      await createSurveyTask(context, { channelSid, taskSid });
      await triggerPostSurveyFlow(context, channelSid);

      return resolve(success(JSON.stringify({ message: 'Post survey init OK!' })));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
