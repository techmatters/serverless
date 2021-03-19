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
  send,
} from '@tech-matters/serverless-helpers';
// eslint-disable-next-line prettier/prettier
import type { PromiseValue } from 'type-fest';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

export type Body = {
  targetSid?: string;
  finalTaskAttributes: string;
};

// eslint-disable-next-line prettier/prettier
type TaskInstance = PromiseValue<ReturnType<ReturnType<ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['tasks']>['fetch']>>;
// eslint-disable-next-line prettier/prettier
type WorkerInstance = PromiseValue<ReturnType<ReturnType<ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['workers']>['fetch']>>;

const assignToAvailableWorker = async (
  event: Body,
  newTask: TaskInstance,
) => {
  const reservations = await newTask.reservations().list();
  const reservation = reservations.find(r => r.workerSid === event.targetSid);

  if (reservation) {
    await reservation.update({ reservationStatus: 'accepted' });
    await reservation.update({ reservationStatus: 'completed' });
    return { type: 'success' } as const;
  } 

  await newTask.remove();
  return {
    type: 'error',
    payload: { status: 500, message: 'Error: reservation for task not created.' },
  } as const;
  
};

const assignToOfflineWorker = async (
  context: Context<EnvVars>,
  event: Body,
  targetWorker: WorkerInstance,
  newTask: TaskInstance,
) => {
  const previousActivity = targetWorker.activitySid;
  const previousAttributes = JSON.parse(targetWorker.attributes);
  const availableActivity = await context
    .getTwilioClient()
    .taskrouter.workspaces(context.TWILIO_WORKSPACE_SID)
    .activities.list({ friendlyName: 'Available' });

  await targetWorker.update({
    activitySid: availableActivity[0].sid,
    attributes: JSON.stringify({ ...previousAttributes, waitingOfflineContact: true, acceptOnlyTask: newTask.sid }), // waitingOfflineContact & acceptOnlyTask are routing rules used to avoid other tasks to be assigned during this window of time
  });

  const result = await assignToAvailableWorker(event, newTask);

  await targetWorker.update({ activitySid: previousActivity, attributes: JSON.stringify(previousAttributes) });

  return result;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { targetSid, finalTaskAttributes } = event;

    try {
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (finalTaskAttributes === undefined) {
        resolve(error400('finalTaskAttributes'));
        return;
      }

      const newAttributes = {
        ...JSON.parse(finalTaskAttributes),
        targetSid,
        transferTargetType: 'worker',
      };

      // create New task
      const newTask = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .tasks.create({
          workflowSid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
          taskChannel: 'default',
          attributes: JSON.stringify(newAttributes),
          priority: 100,
        });

      const targetWorker = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .workers(targetSid)
        .fetch();

      let assignmentResult: PromiseValue<ReturnType<typeof assignToAvailableWorker>>;
      if (targetWorker.available) {
        // assign the task, accept and complete it
        assignmentResult = await assignToAvailableWorker(event, newTask);
      } else {
        // Set the worker available, assign the task, accept, complete it and set worker to previous state
        assignmentResult = await assignToOfflineWorker(context, event, targetWorker, newTask);
      }

      if (assignmentResult.type === 'error') {
        const { status, message } = assignmentResult.payload;
        resolve(send(status)({ status, message }));
        return;
      }

      resolve(success(newTask));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
