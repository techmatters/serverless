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
  transferTargetType?: string;
  helpline?: string;
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const client = context.getTwilioClient();

    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { targetSid, transferTargetType, helpline } = event;

    try {
      if (targetSid === undefined) {
        resolve(error400('targetSid'));
        return;
      }
      if (transferTargetType === undefined) {
        resolve(error400('transferTargetType'));
        return;
      }
      if (helpline === undefined) {
        resolve(error400('helpline'));
        return;
      }

      const newAttributes = {
        targetSid,
        transferTargetType,
        helpline,
        channelType: 'default',
        isContactlessTask: true,
        isInMyBehalf: true,
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
        if (reservations.length && reservations[0].workerSid === targetSid) {
          await reservations[0].update({ reservationStatus: 'accepted' });
          await reservations[0].update({ reservationStatus: 'completed' });
        }
        await targeWorker.update({ activitySid: previousActivity });
      }

      resolve(success(newTask));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
