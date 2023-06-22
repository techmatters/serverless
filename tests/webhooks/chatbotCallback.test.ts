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

import {
  handler as chatbotCallback,
  Body,
} from '../../functions/webhooks/chatbotCallback.protected';
import helpers from '../helpers';
import { LexClient } from '../../functions/helpers/lexClient.private';

// eslint-disable-next-line global-require
const lexClient = require('../../functions/helpers/lexClient.private') as LexClient;

jest.mock('../../functions/helpers/lexClient.private', () => ({
  postText: jest.fn(),
  isEndOfDialog: jest.fn(),
  deleteSession: jest.fn(),
}));

const context = {
  getTwilioClient: jest.fn().mockReturnValue({
    chat: {
      services: jest.fn().mockReturnValue({
        channels: jest.fn().mockReturnValue({
          fetch: jest.fn().mockResolvedValue({
            attributes: JSON.stringify({
              channelSid: 'SID123xxx09sa',
              message: 'Message sent',
              fromServiceUser: 'channelAttributes',
              studioFlowSid: 'FL0123xxdew',
              botName: 'C6HUSTIFBR',
              channelCapturedByBot: {
                botName: 'C6HUSTIFBR',
                botAlias: 'TSTALIASID',
                studioFlowSid: 'FL0123xxdew',
                localeId: 'en_US',
              },
            }),
            messages: jest.fn().mockReturnValue({
              create: jest.fn().mockReturnValue({
                body: 'lexResponse',
                from: 'Bot',
                xTwilioWebhookEnabled: 'true',
              }),
            }),
            update: jest.fn().mockReturnValue({
              attributes: JSON.stringify({
                channelCapturedByBot: {
                  botName: 'C6HUSTIFBR',
                  botAlias: 'TSTALIASID',
                  localeId: 'en_US',
                },
              }),
            }),
            webhooks: jest.fn().mockReturnValue({
              get: jest.fn().mockReturnValue({
                remove: jest.fn().mockReturnValue({}),
              }),
            }),
          }),
          messages: jest.fn().mockReturnValue({
            create: jest.fn().mockResolvedValue({}),
          }),
        }),
      }),
    },
    studio: {
      v2: {
        flows: jest.fn().mockReturnValue({
          executions: {
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      },
    },
    taskrouter: {
      v1: {
        workspaces: jest.fn().mockReturnValue({
          tasks: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        }),
      },
    },
  }),

  DOMAIN_NAME: 'string',
  PATH: 'string',
  SERVICE_SID: 'string',
  ENVIRONMENT_SID: 'string',
  CHAT_SERVICE_SID: 'Ws2xxxxxx',
  ASELO_APP_ACCESS_KEY: 'AW12xx2',
  ASELO_APP_SECRET_KEY: 'KA23xxx09i',
  AWS_REGION: 'us-east-1',
};

const mockCallback = jest.fn();
const lexResponse = {
  message: 'Lex response message',
  dialogState: 'dialogState response state',
  deleteSession: {},
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime(context);
  // eslint-disable-next-line no-underscore-dangle
  runtime._addFunction('webhooks/chatbotCallback', 'functions/webhooks/chatbotCallback.protected');
  helpers.setup({}, runtime);
});

beforeEach(() => {
  const functions = {
    'helpers/lexClient': {
      path: '../../functions/helpers/lexClient.private.ts',
    },
  };

  const getFunctionsMock = jest.fn().mockReturnValue(functions);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  global.Runtime.getFunctions = () => getFunctionsMock();

  lexClient.postText = jest.fn().mockResolvedValue(lexResponse);
  lexClient.isEndOfDialog = jest.fn().mockResolvedValue(lexResponse);
  lexClient.deleteSession = jest.fn().mockResolvedValue(lexResponse);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('chatbotCallback', () => {
  test('should return lexResonse, update channel, and resolve with succes', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'channelAttributes',
      ChannelSid: 'Test channelSid',
      EventType: 'onMessageSent',
    };

    const { attributes } = await context.getTwilioClient().chat.services().channels().fetch();
    await chatbotCallback(context, event, mockCallback);

    // Assert that the necessary functions were called with the correct arguments
    expect(context.getTwilioClient).toHaveBeenCalled();
    expect(context.getTwilioClient().chat.services).toHaveBeenCalledWith(context.CHAT_SERVICE_SID);
    expect(context.getTwilioClient().chat.services().channels).toHaveBeenCalledWith(
      event.ChannelSid,
    );
    expect(context.getTwilioClient().chat.services().channels().fetch).toHaveBeenCalled();

    if (
      event.EventType === 'onMessageSent' &&
      JSON.parse(attributes).fromServiceUser === event.From
    ) {
      const updatedChannelAttributes = {
        channelCapturedByBot: {
          botName: 'C6HUSTIFBR',
          botAlias: 'TSTALIASID',
        },
      };

      const expectedPostTextArgs = [
        context,
        expect.objectContaining({
          botName: updatedChannelAttributes.channelCapturedByBot.botName,
          botAlias: updatedChannelAttributes.channelCapturedByBot.botAlias,
          inputText: event.Body,
        }),
      ];

      const createMessageMock = jest.fn().mockResolvedValueOnce({});
      const channel = {
        messages: jest.fn(() => ({
          create: createMessageMock,
        })),
      };

      await channel.messages().create({
        body: lexResponse.message,
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });

      expect(lexClient.postText).toHaveBeenCalledWith(...expectedPostTextArgs);
      expect(createMessageMock).toHaveBeenCalledWith({
        body: lexResponse.message,
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });

      expect(mockCallback.mock.calls[0][0]).toBeNull();
      expect(mockCallback.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          _body: 'All messages sent :)',
          _statusCode: 200,
        }),
      );
    }
  });

  test('should handle the event and ignore it', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'Test from',
      ChannelSid: 'WA23xxx0ie',
      EventType: 'onMessageSent',
    };

    await chatbotCallback(context, event, mockCallback);

    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: 'Event ignored',
        _statusCode: 200,
      }),
    );
  });

  test('should resolve with error message when event is empty', async () => {
    const event = {};

    await chatbotCallback(context, event, mockCallback);

    // Assert that the necessary functions were called with the correct arguments
    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Error: Body parameter not provided',
          status: 400,
        }),
        _statusCode: 400,
      }),
    );
  });

  test('should handle errors', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'Test from',
      ChannelSid: 'Test channelSid',
      EventType: 'onMessageSent',
    };

    const error = new Error('Test error');
    context.getTwilioClient().chat.services().channels().fetch.mockRejectedValue(error);

    await chatbotCallback(context, event, mockCallback);

    // Assert that the necessary functions were called with the correct arguments
    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Test error',
        }),
        _statusCode: 500,
      }),
    );
  });
});
