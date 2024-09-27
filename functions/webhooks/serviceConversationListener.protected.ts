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

import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';
import {
  Event,
  SendErrorMessageForUnsupportedMedia,
} from '../helpers/sendErrorMessageForUnsupportedMedia.private';

export const handler = async (context: Context, event: Event, callback: ServerlessCallback) => {
  console.info(`===== Service Conversation Listener (event: ${event.EventType})=====`);
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);
  if (event.EventType === 'onMessageAdded') {
    // eslint-disable-next-line global-require,import/no-dynamic-require
    const sendErrorMessageForUnsupportedMedia = require(Runtime.getFunctions()[
      'helpers/sendErrorMessageForUnsupportedMedia'
    ].path).sendErrorMessageForUnsupportedMedia as SendErrorMessageForUnsupportedMedia;

    try {
      console.debug('New message, checking if we need to send error.');
      await sendErrorMessageForUnsupportedMedia(context, event);
    } catch (err) {
      if (err instanceof Error) resolve(error500(err));
      else resolve(error500(new Error(String(err))));
    }
    resolve(success(event));
  }
};
