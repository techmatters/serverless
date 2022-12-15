/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context } from '@twilio-labs/serverless-runtime-types/types';

import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_WRAPUP,
} from '@tech-matters/serverless-helpers/taskrouter';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';
import type { TransferMeta } from './transfersListener.private';
import type { PostSurveyInitHandler } from '../postSurveyInit';

export const eventTypes: EventType[] = [TASK_WRAPUP];

export type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  SURVEY_WORKFLOW_SID: string;
  POST_SURVEY_BOT_CHAT_URL: string;
};

// ================== //
// TODO: unify this code with Flex codebase

const hasTransferStarted = (taskAttributes: {
  transferMeta?: TransferMeta;
}): taskAttributes is { transferMeta: TransferMeta } =>
  Boolean(taskAttributes && taskAttributes.transferMeta);

const hasTaskControl = (taskSid: string, taskAttributes: { transferMeta?: TransferMeta }) =>
  !hasTransferStarted(taskAttributes) || taskAttributes.transferMeta.sidWithTaskControl === taskSid;

const getTaskLanguage = (helplineLanguage: string) => (taskAttributes: { language?: string }) =>
  taskAttributes.language || helplineLanguage;
// ================== //

const isTriggerPostSurvey = (
  eventType: EventType,
  taskSid: string,
  taskChannelUniqueName: string,
  taskAttributes: { channelType?: string; transferMeta?: TransferMeta },
) => {
  if (eventType !== TASK_WRAPUP) return false;

  // Post survey is for chat tasks only. This will change when we introduce voice based post surveys
  if (taskChannelUniqueName !== 'chat') return false;

  if (!hasTaskControl(taskSid, taskAttributes)) return false;

  // Post survey does not plays well with custom channels (autopilot)
  const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
  const channelToFlex = require(handlerPath) as ChannelToFlex;

  if (channelToFlex.isAseloCustomChannel(taskAttributes.channelType)) return false;

  return true;
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const {
      EventType: eventType,
      TaskChannelUniqueName: taskChannelUniqueName,
      TaskSid: taskSid,
      TaskAttributes: taskAttributesString,
    } = event;

    console.log(`===== Executing PostSurveyListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);

    if (isTriggerPostSurvey(eventType, taskSid, taskChannelUniqueName, taskAttributes)) {
      console.log('Handling post survey trigger...');
      const client = context.getTwilioClient();

      // This task is a candidate to trigger post survey. Check feature flags for the account.
      const serviceConfig = await client.flexApi.configuration.get().fetch();
      const { feature_flags: featureFlags, helplineLanguage } = serviceConfig.attributes;

      /** ==================== */
      // TODO: Once all accounts are ready to manage triggering post survey on task wrap within taskRouterCallback, the check on post_survey_serverless_handled can be removed
      if (featureFlags.enable_post_survey && featureFlags.post_survey_serverless_handled) {
        const { channelSid } = taskAttributes;

        const taskLanguage = getTaskLanguage(helplineLanguage)(taskAttributes);

        const handlerPath = Runtime.getFunctions().postSurveyInit.path;
        const postSurveyInitHandler = require(handlerPath)
          .postSurveyInitHandler as PostSurveyInitHandler;

        await postSurveyInitHandler(context, { channelSid, taskSid, taskLanguage });

        console.log('Finished handling post survey trigger.');
      }
    }
    console.log('===== PostSurveyListener finished successfully =====');
  } catch (err) {
    console.log('===== PostSurveyListener has failed =====');
    console.log(String(err));
    throw err;
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const postSurveyListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default postSurveyListener;
