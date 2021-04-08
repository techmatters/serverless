import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import { responseWithCors, bindResolve, error500, success } from '@tech-matters/serverless-helpers';
import moment from 'moment-timezone';

const TokenValidator = require('twilio-flex-token-validator').functionValidator;

type OperatingShift = { open: number; close: number };

enum DaysOfTheWeek {
  Monday = '1',
  Tuesday = '2',
  Wednesday = '3',
  Thursday = '4',
  Friday = '5',
  Saturday = '6',
  Sunday = '7',
}

type OperatingInfo = {
  timezone: string; // the timezone the helpline uses
  holidays: { [date: string]: string }; // a date (in MM/DD/YYYY format) - holiday name object to specify which days are holidays for the helpline
  operatingHours: { [day in DaysOfTheWeek]: OperatingShift[] }; // object that pairs numbers representing weekdays to open and close shifts
};

type EnvVars = {
  OPERATING_INFO_KEY: string;
};

export type Body = {};

const isOpen = (hour: number) => (shift: OperatingShift): boolean =>
  hour >= shift.open && hour < shift.close;

export const handler: ServerlessFunctionSignature = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);

    try {
      const { OPERATING_INFO_KEY } = context;

      if (!OPERATING_INFO_KEY) throw new Error('OPERATING_INFO_KEY env var not provided.');

      const operatingInfo: OperatingInfo = JSON.parse(
        Runtime.getAssets()[`/operatingInfo/${OPERATING_INFO_KEY}.json`].open(),
      );

      if (!operatingInfo)
        throw new Error(
          'Operating Info not found. Check OPERATING_INFO_KEY env vars and a matching OperatingInfo json file for it',
        );

      const { timezone, holidays, operatingHours } = operatingInfo;
      const hour = parseInt(
        moment()
          .tz(timezone)
          .format('Hmm'), // e.g 123 for 1hs 23m, 1345 for 13hs 45m
        10,
      );
      const dayOfWeek = moment()
        .tz(timezone)
        .format('d') as DaysOfTheWeek;
      const currentDate = moment()
        .tz(timezone)
        .format('MM/DD/YYYY');

      if (currentDate in holidays) {
        resolve(success('holiday'));
        return;
      }

      const isInOpenShift = isOpen(hour);
      const isOpenNow = operatingHours[dayOfWeek].some(isInOpenShift);

      if (isOpenNow) {
        resolve(success('open'));
        return;
      }

      resolve(success('closed'));
    } catch (err) {
      resolve(error500(err));
    }
  },
);
