/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import axios from 'axios';
// eslint-disable-next-line prettier/prettier
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import type { BuildSurveyInsightsData, OneToManyConfigSpec } from './helpers/insightsService.private';
import type { BuildDataObject, PostSurveyData } from './helpers/hrmDataManipulation.private';

export type BotMemory = {
  memory: {
    twilio: { collected_data: { collect_survey: { [question: string]: string | number } } };
  };
};

type PostSurveyBody = {
  contactTaskId: string;
  taskId: string;
  data: PostSurveyData;
};

export interface Event {
  Channel: string;
  CurrentTask: string;
  Memory: string;
  UserIdentifier: string;
}

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  HRM_STATIC_KEY: string;
};

const saveSurveyInInsights = async (postSurveyConfigJson: OneToManyConfigSpec[], memory: BotMemory, surveyTask: TaskInstance) => {
  const handlerPath = Runtime.getFunctions()['helpers/insightsService'].path;
  const buildSurveyInsightsData = require(handlerPath)
    .buildSurveyInsightsData as BuildSurveyInsightsData;

  const taskAttributes = JSON.parse(surveyTask.attributes);
  const finalAttributes = buildSurveyInsightsData(postSurveyConfigJson)(taskAttributes, memory);
  console.log('finalAttributes: ', JSON.stringify(finalAttributes));

  await surveyTask.update({ attributes: JSON.stringify(finalAttributes) });
};

const saveSurveyInHRM = async (postSurveyConfigJson: OneToManyConfigSpec[], memory: BotMemory, surveyTask: TaskInstance, hrmBaseUrl: string, hrmStaticKey: string) => {
  const handlerPath = Runtime.getFunctions()['helpers/hrmService'].path;
  const buildDataObject = require(handlerPath)
    .buildDataObject as BuildDataObject;

  const taskAttributes = JSON.parse(surveyTask.attributes);

  const data = buildDataObject(postSurveyConfigJson, memory);

  const body: PostSurveyBody = {
    contactTaskId: taskAttributes.contactTaskId,
    taskId: surveyTask.sid,
    data
  };

  await axios({
    url: `${hrmBaseUrl}/postSurveys`,
    method: 'POST',
    data: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${hrmStaticKey}`
    },
  });
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  console.log('-------- postSurveyComplete execution --------');
  Object.entries(event).forEach(([k, v]) => console.log(k, JSON.stringify(v)));

  try {
    const memory = JSON.parse(event.Memory);
    const { ServiceSid, ChannelSid } = memory.twilio.chat;

    const client = context.getTwilioClient();

    if (event.Channel === 'chat' && event.CurrentTask === 'complete_post_survey') {
      const channel = await client.chat
        .services(ServiceSid)
        .channels(ChannelSid)
        .fetch();

      const channelAttributes = JSON.parse(channel.attributes);

      if (channelAttributes.surveyTaskSid) {
        // get the postSurvey definition
        const serviceConfig = await client.flexApi.configuration.get().fetch();
        const { definitionVersion, hrm_base_url, hrm_api_version } = serviceConfig.attributes;
        const postSurveyConfigJson = Runtime.getAssets()[`/formDefinitions/${definitionVersion}/insights/postSurvey.json`];
        const hrmBaseUrl = `${hrm_base_url}/${hrm_api_version}/accounts/${serviceConfig.accountSid}`;

        // get the survey task
        const surveyTask = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(channelAttributes.surveyTaskSid)
          .fetch();

        if (definitionVersion && postSurveyConfigJson && postSurveyConfigJson.open) {
          const postSurveyConfigSpecs = JSON.parse(postSurveyConfigJson.open()) as OneToManyConfigSpec[];

          // parallel execution to save survey collected data in insights and hrm
          await Promise.all([
            saveSurveyInInsights(postSurveyConfigSpecs, memory, surveyTask),
            saveSurveyInHRM(postSurveyConfigSpecs, memory, surveyTask, hrmBaseUrl, context.HRM_STATIC_KEY),
          ]);
        } else {
          // eslint-disable-next-line no-console
          console.error('Missing definition for post survey. Not saving to insights.');
        }

        await surveyTask.update({ assignmentStatus: 'canceled' }); // can't complete a pending task only cancel it
      }
    }

    const actions = [
      {
        say: 'Thanks!',
      },
    ];
    const returnObj = { actions };

    callback(null, JSON.stringify(returnObj));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    callback(null, { actions: [] });
  }
};
