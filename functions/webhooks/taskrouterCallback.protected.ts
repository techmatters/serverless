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
// eslint-disable-next-line prettier/prettier
import type { PostSurveyJanitor } from '../helpers/postSurveyJanitor.private';

export type Body = {
  EventType: string;
  TaskSid?: string;
  TaskAttributes?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

const TASK_CREATED_EVENT = 'task.created';
const TASK_CANCELED_EVENT = 'task.canceled';
const TASK_COMPLETED_EVENT = 'task.completed';

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { EventType } = event;

    if (EventType === TASK_CREATED_EVENT) {
      const handlerPath = Runtime.getFunctions()['helpers/addCustomerExternalId'].path;
      const addCustomerExternalId = require(handlerPath)
        .addCustomerExternalId as AddCustomerExternalId;
      await addCustomerExternalId(context, event);

      const message = `Event ${EventType} handled by /helpers/addCustomerExternalId`;
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

    if (EventType === TASK_CANCELED_EVENT || EventType === TASK_COMPLETED_EVENT) {
      const taskAttributes = JSON.parse(event.TaskAttributes!);

      if (taskAttributes.isSurveyTask) {
        await wait(3000); // wait 3 seconds just in case some bot message is pending

        const handlerPath = Runtime.getFunctions()['helpers/postSurveyJanitor'].path;
        const postSurveyJanitor = require(handlerPath).postSurveyJanitor as PostSurveyJanitor;
        await postSurveyJanitor(context, {
          channelSid: taskAttributes.channelSid,
          channelType: 'chat',
        });

        const message = `Event ${EventType} handled by /helpers/postSurveyJanitor`;
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
    }

    resolve(success(JSON.stringify({ message: 'Ignored event', EventType })));
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
