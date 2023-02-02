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

export type Body = {
  EventType: string;
  TaskSid?: string;
};

type EnvVars = {
  TWILIO_WORKSPACE_SID: string;
  CHAT_SERVICE_SID: string;
};

export const addTaskSidToChannelAttributes = async (context: Context<EnvVars>, event: Body) => {
  console.log(' ----- addTaskSidToChannelAttributes execution starts ----- ');
  const client = context.getTwilioClient();
  const { TaskSid } = event;

  if (TaskSid === undefined) {
    throw new Error('TaskSid missing in event object');
  }

  const task = await client.taskrouter
    .workspaces(context.TWILIO_WORKSPACE_SID)
    .tasks(TaskSid)
    .fetch();

  const { channelSid } = JSON.parse(task.attributes);

  // Fetch channel to update with a taskId
  const channel = await client.chat.services(context.CHAT_SERVICE_SID).channels(channelSid).fetch();

  const updatedChannel = await channel.update({
    attributes: JSON.stringify({
      ...JSON.parse(channel.attributes),
      taskSid: task.sid,
    }),
  });

  return { message: 'Channel is updated', updatedChannel };
};

export type AddTaskSidToChannelAttributes = typeof addTaskSidToChannelAttributes;
