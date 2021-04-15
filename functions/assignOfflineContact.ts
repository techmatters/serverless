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

type AssignmentResult = {
  type: 'error',
  payload: { status: number, message: string, taskRemoved: boolean, attributes?: string }
} |  { type: 'success', newTask: TaskInstance };

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const cleanUpTask = async (task: TaskInstance, message: string) => {
  const { attributes } = task;
  const taskRemoved = await task.remove();

  return {
    type: 'error',
    payload: { status: 500, message, taskRemoved, attributes },
  } as const;
};

const assignToAvailableWorker = async (
  event: Body,
  newTask: TaskInstance,
  retry: number,
): Promise<AssignmentResult> => {
  const reservations = await newTask.reservations().list();
  const reservation = reservations.find(r => r.workerSid === event.targetSid);

  if (!reservation) {
    if (retry < 3) {
      await wait(200);
      return assignToAvailableWorker(event, newTask, retry + 1);
    }

    return cleanUpTask(newTask, 'Error: reservation for task not created.');
  }

  const accepted = await reservation.update({ reservationStatus: 'accepted' });

  if (accepted.reservationStatus !== 'accepted')
    return cleanUpTask(newTask, 'Error: reservation for task not accepted.');

  const completed = await reservation.update({ reservationStatus: 'completed' });

  if (completed.reservationStatus !== 'completed')
    return cleanUpTask(newTask, 'Error: reservation for task not completed.');

  // eslint-disable-next-line no-console
  if (retry) console.warn(`Needed ${retry} retries to get reservation`);

  return { type: 'success', newTask } as const;
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
    attributes: JSON.stringify({ ...previousAttributes, waitingOfflineContact: true }), // waitingOfflineContact is used to avoid other tasks to be assigned during this window of time (workflow rules)
  });

  const result = await assignToAvailableWorker(event, newTask, 0);

  await targetWorker.update({ activitySid: previousActivity, attributes: JSON.stringify(previousAttributes), rejectPendingReservations: true });

  return result;
};

const assignOfflineContact = async (context: Context<EnvVars>, body: Required<Body>): Promise<AssignmentResult> => {
  const client = context.getTwilioClient();
  const { targetSid, finalTaskAttributes } = body;

  const targetWorker = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .workers(targetSid)
    .fetch();

  const previousAttributes = JSON.parse(targetWorker.attributes);

  if (previousAttributes.waitingOfflineContact)
    return {
      type: 'error',
      payload: { status: 500, message: 'Error: the worker is already waiting for an offline contact.', taskRemoved: false },
    };

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

  if (targetWorker.available) {
    // assign the task, accept and complete it
    return assignToAvailableWorker(body, newTask, 0);
  }
  // Set the worker available, assign the task, accept, complete it and set worker to previous state
  return assignToOfflineWorker(context, body, targetWorker, newTask);
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { targetSid, finalTaskAttributes } = event;

      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (finalTaskAttributes === undefined) {
        resolve(error400('finalTaskAttributes'));
        return;
      }

      const assignmentResult = await assignOfflineContact(context, {targetSid, finalTaskAttributes});

      if (assignmentResult.type === 'error') {
        const { payload } = assignmentResult;
        resolve(send(payload.status)(payload));
        return;
      }

      resolve(success(assignmentResult.newTask));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
