/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, success, error500 } from '@tech-matters/serverless-helpers';

// eslint-disable-next-line prettier/prettier
import type { AddCustomerExternalId } from '../private/addCustomerExternalId.protected';
// eslint-disable-next-line prettier/prettier
import type { PostSurveyJanitor } from '../private/postSurveyJanitor.protected';

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

  const baseUrl = `https://${context.DOMAIN_NAME}`;

  try {
    const { EventType } = event;

    if (EventType === TASK_CREATED_EVENT) {
      const handlerPath = Runtime.getFunctions().addCustomerExternalId.path;
      const addCustomerExternalId = require(handlerPath).addCustomerExternalId as AddCustomerExternalId;
      await addCustomerExternalId(context, event);

      const message = `Redirected event ${TASK_CREATED_EVENT} to ${baseUrl}/addCustomerExternalId`;
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

        const handlerPath = Runtime.getFunctions().postSurveyJanitor.path;
        const postSurveyJanitor = require(handlerPath).postSurveyJanitor as PostSurveyJanitor;
        await postSurveyJanitor(context, { channelSid: taskAttributes.channelSid, channelType: 'chat' });
  
        const message = `Redirected event ${TASK_CREATED_EVENT} to /postSurveyJanitor`;
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    resolve(error500(err));
  }
};
