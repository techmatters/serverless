/**
 * This file is intended to be used as the Task Router Event Callback (see https://www.twilio.com/docs/taskrouter/api/event#event-callbacks).
 * We'll perform different actions based on the event type on each invocation.
 */

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, success, error500 } from '@tech-matters/serverless-helpers';
import { TaskrouterListener, EventFields } from '@tech-matters/serverless-helpers/taskrouter';

const LISTENERS_FOLDER = 'taskrouterListeners/';

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
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
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    await runTaskrouterListeners(context, event, callback);

    const { EventType: eventType } = event;

    resolve(success(JSON.stringify({ eventType })));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
