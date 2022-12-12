/**
 * This file is intended to be used as the Task Router Event Callback (see https://www.twilio.com/docs/taskrouter/api/event#event-callbacks).
 * We'll perform different actions based on the event type on each invocation.
 * As for 2021-09-17:
 *   - On task.created: external customer id is added to the task attributes.
 *   - On task.canceled: post survey janitor is invoked.
 *   - On task.completed: post survey janitor is invoked.
 */

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, success, error500 } from '@tech-matters/serverless-helpers';
import {
  TaskrouterListener,
  EventType,
  EventFields,
  TASK_CREATED,
  TASK_CANCELED,
  TASK_WRAPUP,
  TASK_DELETED,
  TASK_SYSTEM_DELETED,
} from '@tech-matters/serverless-helpers/taskrouter';

// eslint-disable-next-line prettier/prettier
import type { AddCustomerExternalId } from '../helpers/addCustomerExternalId.private';
import type { AddTaskSidToChannelAttributes } from '../helpers/addTaskSidToChannelAttributes.private';
import type { ChatChannelJanitor } from '../helpers/chatChannelJanitor.private';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';

const LISTENERS_FOLDER = 'taskrouterListeners/';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const isCreateContactTask = (
  eventType: EventType,
  taskAttributes: { isContactlessTask?: boolean },
) => eventType === TASK_CREATED && !taskAttributes.isContactlessTask;

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

/**
 * Fetch all taskrouter listeners from the listeners folder
 */
const getListeners = () => {
  const functionsMap = Runtime.getFunctions();
  const keys = Object.keys(functionsMap).filter((name) => name.includes(LISTENERS_FOLDER));
  const paths = keys.map((key) => functionsMap[key].path);
  return paths.map((path) => require(path) as TaskrouterListener);
};

const runTaskrouterListeners = async (
  context: Context<EnvVars>,
  event: EventFields,
  callback: ServerlessCallback,
) => {
  const listeners = getListeners();

  await Promise.all(
    listeners
      .filter((listener) => listener.shouldHandle(event))
      .map((listener) => listener.handleEvent(context, event, callback)),
  );
};

export const handler = async (
  context: Context<EnvVars>,
  event: EventFields,
  callback: ServerlessCallback,
) => {
  console.log(`Task Router Event ${event?.EventType} fired`);
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    await runTaskrouterListeners(context, event, callback);

    const { EventType: eventType } = event;
    const taskAttributes = JSON.parse(event.TaskAttributes!);

    if (isCreateContactTask(eventType, taskAttributes)) {
      // For offline contacts, this is already handled when the task is created in /assignOfflineContact function
      const handlerPath = Runtime.getFunctions()['helpers/addCustomerExternalId'].path;
      const addCustomerExternalId = require(handlerPath)
        .addCustomerExternalId as AddCustomerExternalId;
      await addCustomerExternalId(context, event);

      const message = `Event ${eventType} handled by /helpers/addCustomerExternalId`;
      console.log(message);

      if (taskAttributes.channelType === 'web') {
        // Add taskSid to channel attr so we can end the chat from webchat client (see endChat function)
        const addTaskHandlerPath =
          Runtime.getFunctions()['helpers/addTaskSidToChannelAttributes'].path;
        const addTaskSidToChannelAttributes = require(addTaskHandlerPath)
          .addTaskSidToChannelAttributes as AddTaskSidToChannelAttributes;
        await addTaskSidToChannelAttributes(context, event);
      }

      resolve(
        success(
          JSON.stringify({
            message,
          }),
        ),
      );
    }

    if (isCleanupPostSurvey(eventType, taskAttributes)) {
      await wait(3000); // wait 3 seconds just in case some bot message is pending

      const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
      const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

      const message = `Event matched isCleanupPostSurvey for task sid ${event.TaskSid}`;
      console.log(message);
      resolve(
        success(
          JSON.stringify({
            message,
          }),
        ),
      );
      return;
    }

    if (isCleanupCustomChannel(eventType, taskAttributes)) {
      const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
      const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;

      await chatChannelJanitor(context, { channelSid: taskAttributes.channelSid });

      const message = `Event matched isCleanupCustomChannel for task sid ${event.TaskSid}`;
      console.log(message);
      resolve(
        success(
          JSON.stringify({
            message,
          }),
        ),
      );
      return;
    }

    resolve(success(JSON.stringify({ message: 'Ignored event', eventType })));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
