/* eslint-disable import/no-dynamic-require */
/* eslint-disable global-require */
import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type EnvVars = {
  SYNC_SERVICE_SID: string;
  SAVE_CONTACT_FN: string;
};

type Nullable<T> = T | undefined | null;
type SaveContactFn = (payload: any) => Promise<any>;

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
  event: any,
): Nullable<SaveContactFn> => {
  const functionPath = Runtime.getFunctions()[functionName]?.path;
  if (!functionPath) return;

  const saveContactHandler = require(functionPath)?.handler;
  if (!saveContactHandler) return;

  // eslint-disable-next-line consistent-return
  return payload =>
    new Promise((resolveCallback, rejectCallback) => {
      // Callback passed to saveContactHandler
      const callback: ServerlessCallback = (error: any, callbackPayload: any) => {
        const isError = error || ![200, 204].includes(callbackPayload?.statusCode);
        return isError ? rejectCallback(callbackPayload) : resolveCallback(callbackPayload);
      };

      return saveContactHandler(context, { ...event, payload }, callback);
    });
};

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: any, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    const { SYNC_SERVICE_SID, SAVE_CONTACT_FN } = context;

    try {
      if (!SAVE_CONTACT_FN) throw new Error('SAVE_CONTACT_FN env var not provided.');

      const saveContactFn = getSaveContactFn(SAVE_CONTACT_FN, context, event);
      if (!saveContactFn) {
        return resolve(error500(new Error('Could not find a saveContact function'))); // Should it be HTTP 404?
      }

      const sharedStateClient = context.getTwilioClient().sync.services(SYNC_SERVICE_SID);
      const list = await sharedStateClient.syncLists('pending-contacts').fetch();
      const pendingContacts = await list.syncListItems().list();

      type SyncListItemInstance = typeof pendingContacts[0];

      const successfulRetriesListItems: SyncListItemInstance[] = [];
      const failedRetriesListItems: SyncListItemInstance[] = [];

      await Promise.all(
        pendingContacts.map(listItem => {
          const { payload } = listItem.data;

          return saveContactFn(payload)
            .then(() => successfulRetriesListItems.push(listItem))
            .catch(() => failedRetriesListItems.push(listItem));
        }),
      );

      const incrementRetries = (listItem: SyncListItemInstance) => {
        const updateOptions = {
          data: {
            ...listItem.data,
            retries: (listItem.data.retries || 0) + 1,
          },
        };

        return listItem.update(updateOptions);
      };
      const removeFromPendingContacts = (listItem: SyncListItemInstance) => listItem.remove();

      // Apply changes to pending-contacts sync list
      await Promise.all<SyncListItemInstance | boolean>([
        ...failedRetriesListItems.map(incrementRetries),
        ...successfulRetriesListItems.map(removeFromPendingContacts),
      ]);

      const result = {
        savedContacts: successfulRetriesListItems.length,
        remainingPendingContacts: failedRetriesListItems.length,
      };

      return resolve(success(result));
    } catch (err) {
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
      // eslint-disable-next-line no-console
      console.error(err);
      return resolve(error500(err));
    }
  },
);
