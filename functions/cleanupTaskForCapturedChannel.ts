/* eslint-disable import/no-dynamic-require */
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

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */

// const createTaskForCapturedChannel = async (channelSid, taskAttributes) => {
//     try {
//       // Create the Task using the Taskrouter REST API
//       const task = await client.taskrouter.workspaces(workspaceSid).tasks.create({
//         attributes: JSON.stringify(taskAttributes),
//         taskChannelUniqueName: channelSid, // Use the channelSid as the taskChannelUniqueName
//         // Set other properties as needed, e.g., taskQueueSid or workflowSid
//       });

//       console.log('Task created:', task.sid);

//       // Associate the taskSid with the captured channel
//       await client.chat
//         .services(chatServiceSid)
//         .channels(channelSid)
//         .update({ taskSid: task.sid });

//       console.log('Channel associated with task:', channelSid, '->', task.sid);
//     } catch (error) {
//       console.error('Error creating task for captured channel:', error);
//       // Handle the error as needed
//     }
//   };
