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

import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error500,
  success,
  error400,
} from '@tech-matters/serverless-helpers';
import moment from 'moment-timezone';
import axios from 'axios';

type OperatingShift = { open: number; close: number };

enum DaysOfTheWeek {
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
  Sunday = 7,
}

type OfficeOperatingInfo = {
  timezone: string; // the timezone the helpline uses
  holidays: { [date: string]: string }; // a date (in MM/DD/YYYY format) - holiday name object to specify which days are holidays for the helpline
  operatingHours: { [channel: string]: { [day in DaysOfTheWeek]: OperatingShift[] } }; // object that pairs numbers representing weekdays to open and close shifts
};

// The root contains OfficeOperatingInfo info (default, support legacy) plus an "offices" entry, which maps OfficeOperatingInfo to a particular office
type OperatingInfo = OfficeOperatingInfo & {
  offices: {
    [office: string]: OfficeOperatingInfo;
  };
};

type EnvVars = {
  OPERATING_INFO_KEY: string;
  DISABLE_OPERATING_HOURS_CHECK: string;
};

export type Body = {
  channel?: string;
  office?: string;
  includeMessageTextInResponse?: string;
  language?: string;
};

const isOpen =
  (timeOfDay: number) =>
  (shift: OperatingShift): boolean =>
    timeOfDay >= shift.open && timeOfDay < shift.close;

const getStatusFromEntry = (officeOperatingInfo: OfficeOperatingInfo, channel: string) => {
  if (!officeOperatingInfo || !officeOperatingInfo.operatingHours[channel]) {
    throw new Error(
      `Operating Info not found for channel ${channel}. Check OPERATING_INFO_KEY env vars and a matching OperatingInfo json file for it.`,
    );
  }

  const { timezone, holidays, operatingHours } = officeOperatingInfo;

  const timeOfDay = parseInt(
    moment().tz(timezone).format('Hmm'), // e.g 123 for 1hs 23m, 1345 for 13hs 45m
    10,
  );
  const dayOfWeek = moment().tz(timezone).isoWeekday() as DaysOfTheWeek;
  const currentDate = moment().tz(timezone).format('MM/DD/YYYY');

  if (currentDate in holidays) {
    return 'holiday';
  }

  const isInOpenShift = isOpen(timeOfDay);
  const isOpenNow = operatingHours[channel][dayOfWeek].some(isInOpenShift);

  if (isOpenNow) {
    return 'open';
  }

  return 'closed';
};

const getOperatingStatus = (operatingInfo: OperatingInfo, channel: string, office?: string) => {
  const { offices, ...operatingInfoRoot } = operatingInfo;

  if (office) {
    try {
      const officeEntry = offices[office];

      const status = getStatusFromEntry(officeEntry, channel);
      return status;
    } catch (err) {
      console.warn(`Error trying to access entry for office ${office}`, err);
    }
  }

  // If no office was provided, or the channel is missing in the office entry, return root info
  const status = getStatusFromEntry(operatingInfoRoot, channel);
  return status;
};

type Messages = Required<{
  ClosedOutOfShift?: string;
  ClosedHolidays?: string;
}>;

const getClosedMessage = async (
  context: Context,
  status: 'closed' | 'holiday',
  language: string = 'en-US',
): Promise<string> => {
  const messageKey = status === 'closed' ? 'ClosedOutOfShift' : 'ClosedHolidays';

  // Try to get the translated message
  try {
    const response = await axios.get<Messages>(
      `https://${context.DOMAIN_NAME}/translations/${language}/messages.json`,
    );
    const translation = response.data;

    const message = translation[messageKey];
    if (message) return message;
  } catch {
    console.warn(`Couldn't retrieve EndChatMsg message translation for ${language}`);
  }

  // Return default strings if can't retrieve the translation
  return {
    ClosedOutOfShift: 'The helpline is out of shift, please reach us later.',
    ClosedHolidays: 'The helpline is closed due to a holiday.',
  }[messageKey];
};

const flagIsTrue = (s?: string) => s?.toLowerCase() === 'true';

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const res = responseWithCors();
  const resolve = bindResolve(callback)(res);

  try {
    const { OPERATING_INFO_KEY, DISABLE_OPERATING_HOURS_CHECK } = context;

    const { channel, office, language, includeMessageTextInResponse } = event;

    if (flagIsTrue(DISABLE_OPERATING_HOURS_CHECK)) {
      if (!flagIsTrue(includeMessageTextInResponse)) {
        resolve(success('open'));
        return;
      }

      const response = {
        status: 'open',
        message: undefined,
      };

      resolve(success(response));
    }

    if (!OPERATING_INFO_KEY) throw new Error('OPERATING_INFO_KEY env var not provided.');

    if (channel === undefined) {
      resolve(error400('channel'));
      return;
    }

    const operatingInfo: OperatingInfo = JSON.parse(
      Runtime.getAssets()[`/operatingInfo/${OPERATING_INFO_KEY}.json`].open(),
    );

    const status = getOperatingStatus(operatingInfo, channel, office);

    // Support legacy function to avoid braking changes
    // TODO: remove once every account has been migrated
    if (!flagIsTrue(includeMessageTextInResponse)) {
      resolve(success(status));
      return;
    }

    // Return a the status and, if closed, the appropriate message
    const response = {
      status,
      message: status === 'open' ? undefined : await getClosedMessage(context, status, language),
    };

    resolve(success(response));
  } catch (err: any) {
    resolve(error500(err));
  }
};
