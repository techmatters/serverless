/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

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
  DELEGATE_WEBHOOK_URL: string;
  ACCOUNT_SID: string;
};

type EventFieldsWithRequest = EventFields & {
  request: { headers: Record<string, string | string[]> };
};

/**
 * Fetch all taskrouter listeners from the listeners folder
 */
const getListeners = (): [string, TaskrouterListener][] => {
  const functionsMap = Runtime.getFunctions();
  const keys = Object.keys(functionsMap).filter((name) => name.includes(LISTENERS_FOLDER));
  const paths = keys.map((key) => functionsMap[key].path);
  return paths.map((path) => [path, require(path) as TaskrouterListener]);
};

const runTaskrouterListeners = async (
  context: Context<EnvVars>,
  { request, ...event }: EventFieldsWithRequest,
  callback: ServerlessCallback,
) => {
  const listeners = getListeners();
  const serviceConfig = await context.getTwilioClient().flexApi.configuration.get().fetch();
  const { hrm_base_url: hrmBaseUrl } = serviceConfig.attributes;
  const delegateUrl = `${hrmBaseUrl}/lambda/twilio/account-scoped/${context.ACCOUNT_SID}${context.PATH}`;
  const forwardedHeaderEntries = Object.entries(request.headers).filter(
    ([key]) => key.toLowerCase().startsWith('x-') || key.toLowerCase().startsWith('t-'),
  );
  const delegateHeaders = {
    ...Object.fromEntries(forwardedHeaderEntries),
    'X-Original-Webhook-Url': `https://${context.DOMAIN_NAME}${context.PATH}`,
    'Content-Type': 'application/json',
  };
  console.info('Forwarding to delegate webhook:', delegateUrl);
  console.info('event:', event);
  console.debug('headers:', JSON.stringify(request.headers));
  // Fire and forget
  const delegatePromise = fetch(delegateUrl, {
    method: 'POST',
    headers: delegateHeaders,
    body: JSON.stringify(event),
  });
  await Promise.all([
    delegatePromise,
    ...listeners
      .filter(([, listener]) => listener.shouldHandle(event))
      .map(async ([path, listener]) => {
        console.debug(
          `===== Executing listener at ${path} for event: ${event.EventType}, task: ${event.TaskSid} =====`,
        );
        try {
          await listener.handleEvent(context, event, callback);
        } catch (err) {
          console.error(`===== Listener at ${path} has failed, aborting =====`, err);
        }
      }),
  ]);
  console.info(
    `===== Successfully executed all listeners for event: ${event.EventType}, task: ${event.TaskSid} =====`,
  );
  return null;
};

export const handler = async (
  context: Context<EnvVars>,
  event: EventFieldsWithRequest,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    console.log(`===== Executing TaskrouterCallback for event: ${event.EventType} =====`);
    await runTaskrouterListeners(context, event, callback);

    const { EventType: eventType } = event;

    resolve(success(JSON.stringify({ eventType })));
  } catch (err) {
    if (err instanceof Error) resolve(error500(err));
    else resolve(error500(new Error(String(err))));
  }
};
