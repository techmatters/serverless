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

/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  error403,
  success,
} from '@tech-matters/serverless-helpers';

type EnvVars = {
  SYNC_SERVICE_SID: string;
  SAVE_CONTACT_FN: string;
  SAVE_PENDING_CONTACTS_STATIC_KEY: string;
};

export type Body = {
  ApiKey: string;
  request: { cookies: {}; headers: {} };
};

type Nullable<T> = T | undefined | null;
type SaveContactFn = (payload: any) => Promise<any>;

const isValidRequest = async (context: Context<EnvVars>, event: Body) => {
  const { SAVE_PENDING_CONTACTS_STATIC_KEY } = context;
  const { ApiKey } = event;
  return ApiKey === SAVE_PENDING_CONTACTS_STATIC_KEY;
};

/**
 * Gets a promisefied saveContactFn() given a function name.
 *
 * @param functionName Name of the Serverless Function (e.g. 'saveContactToSaferNet')
 * @param context Context
 * @param event Event
 * @returns @type {Nullable<SaveContactFn>} saveContactFn
 */
const getSaveContactFn = (
  functionName: string,
  context: Context,
  event: Body,
): Nullable<SaveContactFn> => {
  const functionPath = Runtime.getFunctions()[functionName]?.path;
  if (!functionPath) return;

  const saveContactHandler = require(functionPath)?.handler;
  if (!saveContactHandler) return;

  // eslint-disable-next-line consistent-return
  return (payload) =>
    new Promise((resolveCallback, rejectCallback) => {
      // Callback passed to saveContactHandler
      const callback: ServerlessCallback = (error: any, callbackPayload: any) => {
        const isError = error || ![200, 204].includes(callbackPayload?.statusCode);
        return isError
          ? rejectCallback(error || callbackPayload)
          : resolveCallback(callbackPayload);
      };

      return saveContactHandler(context, { ...event, payload }, callback);
    });
};

export const handler: ServerlessFunctionSignature<EnvVars, Body> = async (
  context: Context<EnvVars>,
  event: any,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  const { SYNC_SERVICE_SID, SAVE_CONTACT_FN, SAVE_PENDING_CONTACTS_STATIC_KEY } = context;

  if (!SAVE_CONTACT_FN) throw new Error('SAVE_CONTACT_FN env var not provided.');
  if (!SAVE_PENDING_CONTACTS_STATIC_KEY)
    throw new Error('SAVE_PENDING_CONTACTS_STATIC_KEY env var not provided.');

  const isValid = await isValidRequest(context, event);

  if (!isValid) {
    return resolve(error403('No ApiKey was found'));
  }

  try {
    const saveContactFn = getSaveContactFn(SAVE_CONTACT_FN, context, event);
    if (!saveContactFn) {
      return resolve(error500(new Error('Could not find a saveContact function'))); // Should it be HTTP 404?
    }

    const sharedStateClient = context.getTwilioClient().sync.services(SYNC_SERVICE_SID);
    const list = await sharedStateClient.syncLists('pending-contacts').fetch();
    const pendingContacts = await list.syncListItems().list();
    type SyncListItemInstance = typeof pendingContacts[0];

    let savedContacts = 0;
    let remainingPendingContacts = 0;

    const incrementRetries = async (listItem: SyncListItemInstance) => {
      try {
        const updateOptions = {
          data: {
            ...listItem.data,
            retries: (listItem.data.retries || 0) + 1,
          },
        };

        await listItem.update(updateOptions);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      } finally {
        remainingPendingContacts += 1;
      }
    };

    const removeFromPendingContacts = async (listItem: SyncListItemInstance) => {
      try {
        await listItem.remove();
        savedContacts += 1;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      }
    };

    await Promise.all(
      pendingContacts.map((listItem) => {
        const { payload } = listItem.data;

        return saveContactFn(payload)
          .then(() => removeFromPendingContacts(listItem))
          .catch(() => incrementRetries(listItem));
      }),
    );

    const result = {
      savedContacts,
      remainingPendingContacts,
    };

    return resolve(success(result));
  } catch (err: any) {
    if (
      err instanceof Error &&
      err.message &&
      err.message.includes(
        `The requested resource /Services/${SYNC_SERVICE_SID}/Lists/pending-contacts was not found`,
      )
    ) {
      // Function should not fail or alarm if the sync list 'pending-contacts' doesn't exist yet
      return resolve(success('The sync list pending-contacts was not found'));
    }
    return resolve(error500(err));
  }
};
