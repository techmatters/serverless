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

export interface Event {
  callFrom: string;
}

export const handler = (context: Context, event: Event, callback: ServerlessCallback) => {
  const file = Runtime.getAssets()['/blocklist.json'];
  const blocklist = file ? JSON.parse(file.open()).numbers : [];
  const blocked = blocklist.some((num: string) => event.callFrom.includes(num));
  if (blocked) {
    throw new Error('User is blocked.');
  }
  callback(null, undefined);
};
