/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
// eslint-disable-next-line prettier/prettier
import type { BuildSurveyInsightsData } from './helpers/insightsService.private';

export interface Event {
  Channel: string;
  CurrentTask: string;
  Memory: string;
  UserIdentifier: string;
}

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
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

    // In this webhook we should do stuff with the bot memory, like storing the values in task attributes (Inishgts) or saving in HRM

    if (event.Channel === 'chat' && event.CurrentTask === 'complete_post_survey') {
      const channel = await client.chat
        .services(ServiceSid)
        .channels(ChannelSid)
        .fetch();

      const channelAttributes = JSON.parse(channel.attributes);

      if (channelAttributes.surveyTaskSid) {
        const surveyTask = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(channelAttributes.surveyTaskSid)
          .fetch();

        const handlerPath = Runtime.getFunctions()['helpers/insightsService'].path;
        const buildSurveyInsightsData = require(handlerPath)
          .buildSurveyInsightsData as BuildSurveyInsightsData;

        const serviceConfig = await client.flexApi.configuration.get().fetch();
        const { definitionVersion } = serviceConfig.attributes;
        const postSurveyConfigJson = Runtime.getAssets()[`/formDefinitions/${definitionVersion}/insights/postSurvey.json`];

        if (definitionVersion && postSurveyConfigJson && postSurveyConfigJson.open) {
          const postSurveyConfigSpecs = JSON.parse(postSurveyConfigJson.open());
  
          const taskAttributes = JSON.parse(surveyTask.attributes);
          const finalAttributes = buildSurveyInsightsData(postSurveyConfigSpecs)(taskAttributes, memory);
          console.log('finalAttributes: ', JSON.stringify(finalAttributes));

          await surveyTask.update({ attributes: JSON.stringify(finalAttributes) }); 
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
