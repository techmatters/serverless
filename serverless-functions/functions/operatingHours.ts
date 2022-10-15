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

type OperatingInfo = {
  timezone: string; // the timezone the helpline uses
  holidays: { [date: string]: string }; // a date (in MM/DD/YYYY format) - holiday name object to specify which days are holidays for the helpline
  operatingHours: { [channel: string]: { [day in DaysOfTheWeek]: OperatingShift[] } }; // object that pairs numbers representing weekdays to open and close shifts
};

type EnvVars = {
  OPERATING_INFO_KEY: string;
};

export type Body = {
  channel?: string;
};

const isOpen =
  (timeOfDay: number) =>
  (shift: OperatingShift): boolean =>
    timeOfDay >= shift.open && timeOfDay < shift.close;

export const handler = async (
  context: Context<EnvVars>,
  event: Body,
  callback: ServerlessCallback,
) => {
  const response = responseWithCors();
  const resolve = bindResolve(callback)(response);

  try {
    const { OPERATING_INFO_KEY } = context;

    if (!OPERATING_INFO_KEY) throw new Error('OPERATING_INFO_KEY env var not provided.');

    const { channel } = event;

    if (channel === undefined) {
      resolve(error400('channel'));
      return;
    }

    const operatingInfo: OperatingInfo = JSON.parse(
      Runtime.getAssets()[`/operatingInfo/${OPERATING_INFO_KEY}.json`].open(),
    );

    if (!operatingInfo || !operatingInfo.operatingHours[channel])
      throw new Error(
        `Operating Info not found for channel ${channel}. Check OPERATING_INFO_KEY env vars and a matching OperatingInfo json file for it.`,
      );

    const { timezone, holidays, operatingHours } = operatingInfo;
    const timeOfDay = parseInt(
      moment().tz(timezone).format('Hmm'), // e.g 123 for 1hs 23m, 1345 for 13hs 45m
      10,
    );
    const dayOfWeek = moment().tz(timezone).isoWeekday() as DaysOfTheWeek;
    const currentDate = moment().tz(timezone).format('MM/DD/YYYY');

    if (currentDate in holidays) {
      resolve(success('holiday'));
      return;
    }

    const isInOpenShift = isOpen(timeOfDay);
    const isOpenNow = operatingHours[channel][dayOfWeek].some(isInOpenShift);

    if (isOpenNow) {
      resolve(success('open'));
      return;
    }

    resolve(success('closed'));
  } catch (err: any) {
    resolve(error500(err));
  }
};
