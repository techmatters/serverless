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
} from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

export type Body = {
  targetSid?: string;
  finalTaskAttributes: string;
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

      const targeWorker = await client.taskrouter
        .workspaces(context.TWILIO_WORKSPACE_SID)
        .workers(targetSid)
        .fetch();

      // Set the worker available, assign the task, accept & complete it and set worker to previous state
      if (!targeWorker.available) {
        const previousActivity = targeWorker.activitySid;
        const availableActivity = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .activities.list({ friendlyName: 'Available' });
        await targeWorker.update({ activitySid: availableActivity[0].sid });

        const reservations = await newTask.reservations().list();
        const reservation = reservations.find(r => r.workerSid === targetSid);
        if (reservation) {
          await reservation.update({ reservationStatus: 'accepted' });
          await reservation.update({ reservationStatus: 'completed' });
        }

        await targeWorker.update({ activitySid: previousActivity });
      }

      resolve(success(newTask));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
