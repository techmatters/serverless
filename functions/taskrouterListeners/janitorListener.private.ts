/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context } from '@twilio-labs/serverless-runtime-types/types';

import {
  TaskrouterListener,
  EventFields,
  EventType,
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
} from '@tech-matters/serverless-helpers/taskrouter';

import type { ChatChannelJanitor } from '../helpers/chatChannelJanitor.private';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';

export const eventTypes: EventType[] = [
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
];

type EnvVars = {
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const isCleanupPostSurvey = (eventType: EventType, taskAttributes: { isSurveyTask?: boolean }) =>
  (eventType === TASK_CANCELED || eventType === TASK_WRAPUP) && taskAttributes.isSurveyTask;

const isCleanupCustomChannel = (eventType: EventType, taskAttributes: { channelType?: string }) => {
  if (
    !(
      eventType === TASK_DELETED ||
      eventType === TASK_SYSTEM_DELETED ||
      eventType === TASK_CANCELED
    )
  )
    return false;

  const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
  const channelToFlex = require(handlerPath) as ChannelToFlex;

  return channelToFlex.isAseloCustomChannel(taskAttributes.channelType);
};

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  try {
    const { EventType: eventType, TaskAttributes: taskAttributesString } = event;

    console.log(`===== Executing JanitorListener for event: ${eventType} =====`);

    const taskAttributes = JSON.parse(taskAttributesString);

    if (isCleanupPostSurvey(eventType, taskAttributes)) {
      console.log('Handling clean up post-survey...');
      await wait(3000); // wait 3 seconds just in case some bot message is pending

      const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
      const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

      console.log('Finished handling clean up post-survey.');
      return;
    }

    if (isCleanupCustomChannel(eventType, taskAttributes)) {
      console.log('Handling clean up custom channel...');

      const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
      const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

      console.log('Finished handling clean up custom channel.');
      return;
    }

    console.log('===== JanitorListener finished successfully =====');
  } catch (err) {
    console.log('===== JanitorListener has failed =====');
    console.log(String(err));
    throw err;
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const transfersListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default transfersListener;
