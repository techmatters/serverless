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

import axios from 'axios';
import each from 'jest-each';
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';

import helpers, { MockedResponse } from '../../helpers';
import { handler as FlexToLine } from '../../../functions/webhooks/line/FlexToLine.protected';

jest.mock('axios', () => ({
  request: jest.fn(),
}));

const mockAxiosRequest = axios.request as jest.MockedFunction<typeof axios.request>;

const channels: { [x: string]: any } = {
  CHANNEL_SID: {
    sid: 'CHANNEL_SID',
    attributes: JSON.stringify({ from: 'channel-from' }),
  },
};

const baseContext = {
  getTwilioClient: (): any => ({
    chat: {
      services: (serviceSid: string) => {
        if (serviceSid === 'not-existing') throw new Error('Service does not exists.');

        return {
          channels: (channelSid: string) => {
            if (!channels[channelSid]) throw new Error('Channel does not exists.');

            return { fetch: async () => channels[channelSid], ...channels[channelSid] };
          },
        };
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  PATH: '',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const validEvent = ({ recipientId = 'recipientIdX', From = 'senderId', Source = 'API' } = {}) => ({
  recipientId,
  Source,
  Body: 'the message text',
  EventType: 'onMessageSent',
  ChannelSid: 'CHANNEL_SID',
  From,
});

describe('FlexToLine', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime(baseContext);
    // eslint-disable-next-line no-underscore-dangle
    runtime._addFunction(
      'helpers/customChannels/flexToCustomChannel',
      'functions/helpers/customChannels/flexToCustomChannel.private',
    );
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });
  each([
    {
      conditionDescription: 'the recipientId parameter not provided',
      event: { ...validEvent(), recipientId: undefined },
      expectedStatus: 400,
      expectedMessage: 'Error: recipientId parameter not provided',
    },
    {
      conditionDescription: 'the Body parameter not provided',
      event: {
        ...validEvent(),
        Body: undefined,
      },
      expectedStatus: 400,
      expectedMessage: 'Error: Body parameter not provided',
    },
    {
      conditionDescription: 'the ChannelSid parameter not provided',
      event: {
        ...validEvent(),
        ChannelSid: undefined,
      },
      expectedStatus: 400,
      expectedMessage: 'Error: ChannelSid parameter not provided',
    },
    {
      conditionDescription: 'the chat service for the SID does not exist',
      event: validEvent(),
      sid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Service does not exists.',
    },
    {
      conditionDescription: 'the Line endpoint returns a 500 error',
      event: validEvent(),
      endpointImpl: () => {
        throw new Error('BOOM');
      },
      expectedStatus: 500,
      expectedMessage: 'BOOM',
    },
  ]).test(
    "Should return $expectedStatus '$expectedMessage' error when $conditionDescription.",
    async ({
      event,
      sid = 'CHAT_SERVICE_SID',
      endpointImpl = async () => ({ status: 200, data: 'OK' }),
      expectedStatus,
      expectedMessage,
    }) => {
      mockAxiosRequest.mockImplementation(endpointImpl);
      let response: MockedResponse | undefined;
      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };

      await FlexToLine(
        {
          ...baseContext,
          CHAT_SERVICE_SID: sid,
          PATH: '',
          SERVICE_SID: undefined,
          ENVIRONMENT_SID: undefined,
        },
        event,
        callback,
      );

      expect(response).toBeDefined();
      if (response) {
        // Matching like this reports the message and the status in the fail message, rather than just one or the other, which you get with 2 separate checks
        expect({ status: response.getStatus(), message: response.getBody().message }).toMatchObject(
          {
            status: expectedStatus,
            message: expect.stringContaining(expectedMessage),
          },
        );
      }
    },
  );

  each([
    {
      conditionDescription: 'the event source is not supported',
      event: validEvent({ Source: 'not supported' }),
      shouldBeIgnored: true,
    },
    {
      conditionDescription: "event 'From' property matches channel 'from' attribute",
      event: validEvent({ From: 'channel-from' }),
      shouldBeIgnored: true,
    },
    {
      conditionDescription: "event 'Source' property is set to 'API'",
      event: validEvent(),
      shouldBeIgnored: false,
    },
    {
      conditionDescription: "event 'Source' property is set to 'SDK'",
      event: validEvent({ Source: 'SDK' }),
      shouldBeIgnored: false,
    },
  ]).test(
    'Should return status 200 success (ignored: $shouldBeIgnored) when $conditionDescription.',
    async ({ event, shouldBeIgnored }) => {
      mockAxiosRequest.mockClear();

      mockAxiosRequest.mockImplementation(async () => ({ status: 200, data: 'OK' }));
      let response: MockedResponse | undefined;
      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };
      await FlexToLine(baseContext, event, callback);

      if (shouldBeIgnored) {
        expect(mockAxiosRequest).not.toBeCalled();
      } else {
        expect(mockAxiosRequest).toBeCalledWith(
          expect.objectContaining({
            url: 'https://api.line.me/v2/bot/message/push',
            method: 'post',
            data: JSON.stringify({
              to: event.recipientId,
              messages: [
                {
                  type: 'text',
                  text: event.Body,
                },
              ],
            }),
            headers: {
              'Content-Type': 'application/json',
              'X-Line-Retry-Key': expect.any(String), // Random uuid
              Authorization: `Bearer ${baseContext.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          }),
        );
      }

      expect(response).toBeDefined();
      if (response) {
        expect({ status: response.getStatus(), body: response.getBody() }).toMatchObject({
          status: 200,
          body: shouldBeIgnored ? expect.stringContaining('Ignored event.') : expect.anything(),
        });
      }
    },
  );
});
