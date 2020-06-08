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
} from 'tech-matters-serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
};

export type Body = {
  taskSid?: string;
  reservationSid?: string;
};

async function closeReservation(context: Context<EnvVars>, body: Required<Body>) {
  const client = context.getTwilioClient();

  const closedReservation = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(body.taskSid)
    .reservations(body.reservationSid)
    .update({
      reservationStatus: 'completed',
    });

  return closedReservation;
}

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { taskSid, reservationSid } = event;

    try {
      if (taskSid === undefined) {
        resolve(error400('taskSid'));
        return;
      }
      if (reservationSid === undefined) {
        resolve(error400('reservationSid'));
        return;
      }

      const validBody = { taskSid, reservationSid };

      const closedReservation = await closeReservation(context, validBody);

      resolve(success({ closed: closedReservation.sid }));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
