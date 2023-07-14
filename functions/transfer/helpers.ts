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

export type TransferMeta = {
  mode: 'COLD' | 'WARM';
  transferStatus: 'transferring' | 'accepted' | 'rejected';
  sidWithTaskControl: string;
};

export type Attributes = {
  transferMeta?: TransferMeta;
  isContactlessTask?: true;
  isInMyBehalf?: true;
  taskSid: string;
  channelType?: string;
};

export const offlineContactTaskSid = 'offline-contact-task-sid';

export const isInMyBehalfITask = (task: Attributes) =>
  task && task.isContactlessTask && task.isInMyBehalf;

export const isOfflineContactTask = (task: Attributes) => task.taskSid === offlineContactTaskSid;

export const isTwilioTask = (task: Attributes) =>
  task && !isOfflineContactTask(task) && !isInMyBehalfITask(task);

export const hasTransferStarted = (task: Attributes) => Boolean(task && task.transferMeta);

export const hasTaskControl = (task: Attributes) =>
  !isTwilioTask(task) ||
  !hasTransferStarted(task) ||
  task.transferMeta?.sidWithTaskControl === task.taskSid;
