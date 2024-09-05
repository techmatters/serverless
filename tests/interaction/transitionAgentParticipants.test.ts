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

import { Twilio } from 'twilio';
import { WorkspaceContext } from 'twilio/lib/rest/taskrouter/v1/workspace';
import { TaskContext } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import { InteractionContext } from 'twilio/lib/rest/flexApi/v1/interaction';
import { InteractionChannelContext } from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel';
import {
  InteractionChannelParticipantContext,
  InteractionChannelParticipantInstance,
} from 'twilio/lib/rest/flexApi/v1/interaction/interactionChannel/interactionChannelParticipant';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler } from '../../functions/interaction/transitionAgentParticipants';
import helpers, { RecursivePartial } from '../helpers';
import MockedFunction = jest.MockedFunction;

jest.mock('@tech-matters/serverless-helpers', () => ({
  ...jest.requireActual('@tech-matters/serverless-helpers'),
  functionValidator: (handlerFn: any) => handlerFn,
}));

const TASKROUTER_WORKSPACE_SID = 'WS123';
const FLEX_INTERACTION_SID = 'KD123';
const FLEX_INTERACTION_CHANNEL_SID = 'KC123';

const mockTaskFetch: MockedFunction<TaskContext['fetch']> = jest.fn().mockResolvedValue({
  attributes: JSON.stringify({
    flexInteractionSid: FLEX_INTERACTION_SID,
    flexInteractionChannelSid: FLEX_INTERACTION_CHANNEL_SID,
  }),
  reservations: () => ({
    list: () => Promise.resolve([{ workerSid: 'WKworker_with_reservation' }]),
  }),
});

const mockTaskGet: MockedFunction<WorkspaceContext['tasks']['get']> = jest.fn().mockReturnValue({
  fetch: mockTaskFetch,
});

const mockWorkspaceGet: MockedFunction<Twilio['taskrouter']['workspaces']['get']> = jest
  .fn()
  .mockReturnValue({
    tasks: {
      get: mockTaskGet,
    },
  });

const mockInteractionChannelParticipantUpdate: MockedFunction<
  InteractionChannelParticipantContext['update']
> = jest.fn().mockResolvedValue({});

const mockInteractionChannelParticipantList: MockedFunction<
  InteractionChannelContext['participants']['list']
> = jest.fn().mockResolvedValue([
  {
    type: 'agent',
    status: 'nothing',
    update: mockInteractionChannelParticipantUpdate,
  },
  {
    type: 'not agent',
    status: 'nothing',
    update: mockInteractionChannelParticipantUpdate,
  },
]);

const mockInteractionChannelGet: MockedFunction<InteractionContext['channels']['get']> = jest
  .fn()
  .mockReturnValue({
    participants: {
      list: mockInteractionChannelParticipantList,
    },
  });

const mockInteractionGet: MockedFunction<Twilio['flexApi']['v1']['interaction']['get']> = jest
  .fn()
  .mockReturnValue({
    channels: {
      get: mockInteractionChannelGet,
    },
  });

const mockTwilioClient: RecursivePartial<Twilio> = {
  taskrouter: {
    v1: {
      workspaces: {
        get: mockWorkspaceGet,
      },
    },
  },
  flexApi: {
    v1: {
      interaction: {
        get: mockInteractionGet,
      },
    },
  },
};

const baseContext = {
  getTwilioClient: (): Twilio => mockTwilioClient as ReturnType<Context['getTwilioClient']>,
  TWILIO_WORKSPACE_SID: TASKROUTER_WORKSPACE_SID,
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime({});
  // eslint-disable-next-line no-underscore-dangle
  runtime._addFunction(
    'interaction/interactionChannelParticipants',
    'functions/interaction/interactionChannelParticipants.private',
  );
  helpers.setup({}, runtime);
});

afterAll(() => {
  helpers.teardown();
});

afterEach(jest.clearAllMocks);

describe('sid for valid task', () => {
  test('looks up task by specified sid', async () => {
    const callback = jest.fn();
    await handler(
      baseContext,
      {
        taskSid: 'WT123',
        targetStatus: 'wrapup',
        request: { headers: {}, cookies: {} },
        tokenResult: { worker_sid: 'WKbob', roles: ['supervisor'] },
      },
      callback,
    );
    expect(mockTaskGet).toHaveBeenCalledWith('WT123');
    expect(mockTaskFetch).toHaveBeenCalled();
  });
  test('looks up interaction using task attributes', async () => {
    const callback = jest.fn();
    await handler(
      baseContext,
      {
        taskSid: 'WT123',
        targetStatus: 'wrapup',
        request: { headers: {}, cookies: {} },
        tokenResult: { worker_sid: 'WKworker_with_reservation', roles: ['agent'] },
      },
      callback,
    );
    expect(mockInteractionGet).toHaveBeenCalledWith(FLEX_INTERACTION_SID);
    expect(mockInteractionChannelGet).toHaveBeenCalledWith(FLEX_INTERACTION_CHANNEL_SID);
  });
  test("looks up interaction using task attributes, and updates those with type 'agent'", async () => {
    const callback = jest.fn();
    await handler(
      baseContext,
      {
        taskSid: 'WT123',
        targetStatus: 'wrapup',
        request: { headers: {}, cookies: {} },
        tokenResult: { worker_sid: 'WKworker_with_reservation', roles: [] },
      },
      callback,
    );
    expect(mockInteractionChannelParticipantList).toHaveBeenCalled();
    expect(mockInteractionChannelParticipantUpdate).toHaveBeenCalledWith({ status: 'wrapup' });
    expect(
      (
        mockInteractionChannelParticipantUpdate.mock
          .contexts[0] as InteractionChannelParticipantInstance
      ).type,
    ).toBe('agent');
  });
  test('called by worker without supervisor role or reservation on task - 403', async () => {
    const callback: MockedFunction<ServerlessCallback> = jest.fn();
    await handler(
      baseContext,
      {
        taskSid: 'WT123',
        targetStatus: 'wrapup',
        request: { headers: {}, cookies: {} },
        tokenResult: { worker_sid: 'WKbob', roles: ['agent'] },
      },
      callback,
    );
    expect(mockInteractionChannelParticipantList).not.toHaveBeenCalled();
    expect(mockInteractionChannelParticipantUpdate).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        _statusCode: 403,
      }),
    );
  });
});
