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
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
// We use axios instead of node-fetch in this repo because the later one raises a run time error when trying to import it. The error is related to how JS modules are loaded.
import axios from 'axios';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import type {
  BuildSurveyInsightsData,
  OneToManyConfigSpec,
} from './helpers/insightsService.private';
import type { BuildDataObject, PostSurveyData } from './helpers/hrmDataManipulation.private';

export type AutopilotMemory = {
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
  request: { cookies: {}; headers: {} };
}

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  HRM_STATIC_KEY: string;
};

const pathBuilder = (question: string) =>
  `twilio.collected_data.collect_survey.answers.${question}.answer`;

const saveSurveyInInsights = async (
  postSurveyConfigJson: OneToManyConfigSpec[],
  memory: AutopilotMemory,
  surveyTask: TaskInstance,
  surveyTaskAttributes: any,
) => {
  const handlerPath = Runtime.getFunctions()['helpers/insightsService'].path;
  const buildSurveyInsightsData = require(handlerPath)
    .buildSurveyInsightsData as BuildSurveyInsightsData;

  const finalAttributes = buildSurveyInsightsData(
    postSurveyConfigJson,
    surveyTaskAttributes,
    memory,
    pathBuilder,
  );

  await surveyTask.update({ attributes: JSON.stringify(finalAttributes) });
};

const saveSurveyInHRM = async (
  postSurveyConfigJson: OneToManyConfigSpec[],
  memory: AutopilotMemory,
  surveyTask: TaskInstance,
  surveyTaskAttributes: any,
  hrmBaseUrl: string,
  hrmStaticKey: string,
) => {
  const handlerPath = Runtime.getFunctions()['helpers/hrmDataManipulation'].path;
  const buildDataObject = require(handlerPath).buildDataObject as BuildDataObject;

  const data = buildDataObject(postSurveyConfigJson, memory, pathBuilder);

  const body: PostSurveyBody = {
    contactTaskId: surveyTaskAttributes.contactTaskId,
    taskId: surveyTask.sid,
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

const getPostSurveyCompleteMessage = async (
  context: Context,
  taskLanguage: string | undefined,
): Promise<string> => {
  try {
    const language = taskLanguage || 'en-US';

    const response = await axios.get(
      `https://${context.DOMAIN_NAME}/translations/${language}/postSurveyMessages.json`,
    );
    const translation = response.data;

    if (translation.postSurveyCompleteMessage) return translation.postSurveyCompleteMessage;
  } catch {
    console.error(
      `Couldn't retrieve postSurveyCompleteMessage translation for ${taskLanguage}, neither default (en-US).`,
    );
  }

  return 'Thank you for reaching out. Please contact us again if you need more help.';
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  console.log('-------- postSurveyComplete execution --------');

  try {
    const memory = JSON.parse(event.Memory);
    const { ServiceSid, ChannelSid } = memory.twilio.chat;

    const client = context.getTwilioClient();

    let taskLanguage: string | undefined;

    if (event.Channel === 'chat' && event.CurrentTask === 'complete_post_survey') {
      const channel = await client.chat.services(ServiceSid).channels(ChannelSid).fetch();

      const channelAttributes = JSON.parse(channel.attributes);

      if (channelAttributes.surveyTaskSid) {
        // get the postSurvey definition
        const serviceConfig = await client.flexApi.configuration.get().fetch();
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { definitionVersion, hrm_base_url, hrm_api_version } = serviceConfig.attributes;
        const postSurveyConfigJson =
          Runtime.getAssets()[`/formDefinitions/${definitionVersion}/insights/postSurvey.json`];
        const hrmBaseUrl = `${hrm_base_url}/${hrm_api_version}/accounts/${serviceConfig.accountSid}`;

        // get the survey task
        const surveyTask = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(channelAttributes.surveyTaskSid)
          .fetch();

        if (definitionVersion && postSurveyConfigJson && postSurveyConfigJson.open) {
          const postSurveyConfigSpecs = JSON.parse(
            postSurveyConfigJson.open(),
          ) as OneToManyConfigSpec[];

          const surveyTaskAttributes = JSON.parse(surveyTask.attributes);

          // Set the taskLanguage carried over from the original task, if any
          taskLanguage = surveyTaskAttributes.language;

          // parallel execution to save survey collected data in insights and hrm
          await Promise.all([
            saveSurveyInInsights(postSurveyConfigSpecs, memory, surveyTask, surveyTaskAttributes),
            saveSurveyInHRM(
              postSurveyConfigSpecs,
              memory,
              surveyTask,
              surveyTaskAttributes,
              hrmBaseUrl,
              context.HRM_STATIC_KEY,
            ),
          ]);
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

        // As survey tasks will never be assigned to a worker, they'll be kept in pending state. A pending can't transition to completed state, so we cancel them here to raise a task.canceled taskrouter event.
        await surveyTask.update({ assignmentStatus: 'canceled' });
      }
    }

    const say = await getPostSurveyCompleteMessage(context, taskLanguage);

    // This is the tasks that are sent back to the bot. For now, it just sends a thanks message before finishing bot's execution.
    const actions = [
      {
        say,
      },
    ];
    const returnObj = { actions };

    callback(null, JSON.stringify(returnObj));
  } catch (err: any) {
    callback(null, { actions: [] });
  }
};
