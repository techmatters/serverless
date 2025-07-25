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

import { Context } from '@twilio-labs/serverless-runtime-types/types';
import {
  EventType,
  RESERVATION_ACCEPTED,
  RESERVATION_REJECTED,
  EventFields,
  TaskrouterListener,
} from '@tech-matters/serverless-helpers/taskrouter';
import type { AdjustChatCapacityType } from '../adjustChatCapacity';

export const eventTypes: EventType[] = [RESERVATION_ACCEPTED, RESERVATION_REJECTED];

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

/**
 * Checks the event type to determine if the listener should handle the event or not.
 * If it returns true, the taskrouter will invoke this listener.
 */
export const shouldHandle = (event: EventFields) => eventTypes.includes(event.EventType);

/**
 * After a reservation is accepted, we reset the capacity to 1
 * We only need to increase capacity temporarily to accept an additional task under certain circumstances like transfers and manual task pulls
 * So since for 'regular' auto assigned tasks resetting to 1 is a noop, we can just always reset to 1 when any reservation is accepted / rejected
 * @param context
 * @param event
 */
export const handleEvent = async (context: Context<EnvVars>, event: EventFields) => {
  const { WorkerSid: workerSid, TaskChannelUniqueName: taskChannelUniqueName } = event;
  if (taskChannelUniqueName !== 'chat') return;
  const serviceConfig = await context.getTwilioClient().flexApi.configuration.get().fetch();
  const {
    feature_flags: { enable_manual_pulling: enabledManualPulling },
  } = serviceConfig.attributes;

  if (enabledManualPulling) {
    const { path } = Runtime.getFunctions().adjustChatCapacity;

    // eslint-disable-next-line global-require,import/no-dynamic-require,prefer-destructuring
    const adjustChatCapacity: AdjustChatCapacityType = require(path).adjustChatCapacity;
    const body = {
      workerSid,
      adjustment: 'setTo1',
    } as const;

    const { status, message } = await adjustChatCapacity(context, body);
    console.log(`===== AdjustCapacityListener completed: status ${status}, '${message}' =====`);
  } else {
    console.log('===== AdjustCapacityListener skipped - flag not enabled =====');
  }
};

/**
 * The taskrouter callback expects that all taskrouter listeners return
 * a default object of type TaskrouterListener.
 */
const adjustCapacityListener: TaskrouterListener = {
  shouldHandle,
  handleEvent,
};

export default adjustCapacityListener;
