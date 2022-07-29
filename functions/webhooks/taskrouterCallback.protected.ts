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

// eslint-disable-next-line prettier/prettier
import type { AddCustomerExternalId } from '../helpers/addCustomerExternalId.private';
import type { ChatChannelJanitor } from '../helpers/chatChannelJanitor.private';
import type { ChannelToFlex } from '../helpers/customChannels/customChannelToFlex.private';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';
const TASK_CANCELED_EVENT = 'task.canceled';
const TASK_COMPLETED_EVENT = 'task.completed';
const TASK_DELETED_EVENT = 'task.deleted';
const TASK_SYSTEM_DELETED_EVENT = 'task.system-deleted';

// Note: there are more of this, we just list the ones we care about. https://www.twilio.com/docs/taskrouter/api/event/reference
const eventTypes = [
  TASK_CREATED_EVENT,
  TASK_CANCELED_EVENT,
  TASK_COMPLETED_EVENT,
  TASK_DELETED_EVENT,
  TASK_SYSTEM_DELETED_EVENT,
] as const;

type EventType = typeof eventTypes[number];

export type Body = {
  EventType: EventType;
  TaskSid?: string;
  TaskAttributes?: string;
};

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const isCleanupPostSurvey = (eventType: EventType, taskAttributes: { isSurveyTask?: boolean }) =>
  (eventType === TASK_CANCELED_EVENT || eventType === TASK_COMPLETED_EVENT) && taskAttributes.isSurveyTask;

const isCleanupCustomChannel = (eventType: EventType, taskAttributes: { channelType?: string }) => {
  if (!(eventType === TASK_DELETED_EVENT || eventType === TASK_SYSTEM_DELETED_EVENT || eventType === TASK_CANCELED_EVENT)) return false;

  const handlerPath = Runtime.getFunctions()['helpers/customChannels/customChannelToFlex'].path;
  const channelToFlex = require(handlerPath) as ChannelToFlex;

  return channelToFlex.isAseloCustomChannel(taskAttributes.channelType);
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { EventType: eventType } = event;

    if (eventType === TASK_CREATED_EVENT) {
      const handlerPath = Runtime.getFunctions()['helpers/addCustomerExternalId'].path;
      const addCustomerExternalId = require(handlerPath).addCustomerExternalId as AddCustomerExternalId;
      await addCustomerExternalId(context, event);

      const message = `Event ${eventType} handled by /helpers/addCustomerExternalId`;
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

    const taskAttributes = JSON.parse(event.TaskAttributes!);

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
