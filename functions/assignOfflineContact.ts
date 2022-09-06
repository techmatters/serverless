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

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

export type Body = {
  targetSid?: string;
  finalTaskAttributes: string;
  request: { cookies: {}; headers: {} };
};

// eslint-disable-next-line prettier/prettier
type TaskInstance = Awaited<ReturnType<ReturnType<ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['tasks']>['fetch']>>;
// eslint-disable-next-line prettier/prettier
type WorkerInstance = Awaited<ReturnType<ReturnType<ReturnType<ReturnType<Context['getTwilioClient']>['taskrouter']['workspaces']>['workers']>['fetch']>>;

type AssignmentResult =
  | {
      type: 'error';
      payload: { status: number; message: string; taskRemoved: boolean; attributes?: string };
    }
  | { type: 'success'; newTask: TaskInstance };

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
  retry: number = 0,
): Promise<AssignmentResult> => {
  const reservations = await newTask.reservations().list();
  const reservation = reservations.find((r) => r.workerSid === event.targetSid);

  if (!reservation) {
    if (retry < 8) {
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
    .activities.list({ available: 'true' });

  if (availableActivity.length > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      `There are ${availableActivity.length} available worker activities, but there should only be one.`,
    );
  }

  await targetWorker.update({
    activitySid: availableActivity[0].sid,
    attributes: JSON.stringify({ ...previousAttributes, waitingOfflineContact: true }), // waitingOfflineContact is used to avoid other tasks to be assigned during this window of time (workflow rules)
  });

  const result = await assignToAvailableWorker(event, newTask);

  await targetWorker.update({
    activitySid: previousActivity,
    attributes: JSON.stringify(previousAttributes),
    rejectPendingReservations: true,
  });

  return result;
};

const assignOfflineContact = async (
  context: Context<EnvVars>,
  body: Required<Body>,
): Promise<AssignmentResult> => {
  const client = context.getTwilioClient();
  const { targetSid, finalTaskAttributes } = body;

  const targetWorker = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .workers(targetSid)
    .fetch();

  const targetWorkerAttributes = JSON.parse(targetWorker.attributes);

  if (targetWorkerAttributes.helpline === undefined)
    return {
      type: 'error',
      payload: {
        status: 500,
        message:
          'Error: the worker does not have helpline attribute set, check the worker configuration.',
        taskRemoved: false,
      },
    };

  if (targetWorkerAttributes.waitingOfflineContact)
    return {
      type: 'error',
      payload: {
        status: 500,
        message: 'Error: the worker is already waiting for an offline contact.',
        taskRemoved: false,
      },
    };

  const queueRequiredTaskAttributes = {
    helpline: targetWorkerAttributes.helpline,
    channelType: 'default',
    isContactlessTask: true,
    isInMyBehalf: true,
  };

  // create New task
  const newTask = await client.taskrouter.workspaces(context.TWILIO_WORKSPACE_SID).tasks.create({
    workflowSid: context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID,
    taskChannel: 'default',
    attributes: JSON.stringify(queueRequiredTaskAttributes),
    priority: 100,
  });

  const newTaskAttributes = JSON.parse(newTask.attributes);
  const parsedFinalAttributes = JSON.parse(finalTaskAttributes);
  const routingAttributes = {
    targetSid,
    transferTargetType: 'worker',
    helpline: targetWorkerAttributes.helpline,
    channelType: 'default',
    isContactlessTask: true,
    isInMyBehalf: true,
  };

  const mergedAttributes = {
    ...newTaskAttributes,
    ...parsedFinalAttributes,
    ...routingAttributes,
    customers: {
      ...parsedFinalAttributes.customers,
      external_id: newTask.sid,
    },
  };

  const updatedTask = await newTask.update({ attributes: JSON.stringify(mergedAttributes) });

  if (targetWorker.available) {
    // assign the task, accept and complete it
    return assignToAvailableWorker(body, updatedTask);
  }
  // Set the worker available, assign the task, accept, complete it and set worker to previous state
  return assignToOfflineWorker(context, body, targetWorker, updatedTask);
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

      const assignmentResult = await assignOfflineContact(context, {
        targetSid,
        finalTaskAttributes,
        request: { cookies: {}, headers: {} },
      });

      if (assignmentResult.type === 'error') {
        const { payload } = assignmentResult;
        resolve(send(payload.status)(payload));
        return;
      }

      resolve(success(assignmentResult.newTask));
    } catch (err: any) {
      resolve(error500(err));
    }
  },
);
