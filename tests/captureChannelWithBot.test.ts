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
import {
  handler as captureChannelWithBot,
  Body,
} from '../functions/captureChannelWithBot.protected';
import helpers from './helpers';
import { LexClient } from '../functions/helpers/lexClient.private';

// eslint-disable-next-line global-require
const lexClient = require('../functions/helpers/lexClient.private') as LexClient;

jest.mock('../functions/helpers/lexClient.private', () => ({
  postText: jest.fn(),
}));

const fetch = jest.fn().mockReturnValue({
  attributes: JSON.stringify({
    channelCapturedByBot: {
      botId: 'C6HUSTIFBR',
      botAliasId: 'TSTALIASID',
      localeId: 'en_US',
    },
  }),
  webhooks: jest.fn().mockReturnValue({
    create: jest.fn().mockReturnValue({}),
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
  messages: jest.fn().mockReturnValue({
    create: jest.fn().mockReturnValue({
      body: 'lexResponse',
      from: 'Bot',
      xTwilioWebhookEnabled: 'true',
    }),
  }),
});

const mockContext = {
  getTwilioClient: jest.fn().mockImplementation(() => ({
    chat: {
      v2: {
        services: jest.fn().mockReturnValue({
          channels: jest.fn().mockReturnValue({
            fetch,
          }),
        }),
      },
      services: jest.fn().mockReturnValue({
        channels: jest.fn().mockReturnValue({
          webhooks: {
            list: jest.fn().mockReturnValue([]),
          },
        }),
      }),
    },
    taskrouter: {
      workspaces: jest.fn().mockReturnValue({
        tasks: {
          create: jest.fn().mockReturnValue({}),
        },
      }),
    },
  })),
  DOMAIN_NAME: 'domain.com',
  PATH: 'string',
  SERVICE_SID: 'string',
  ENVIRONMENT_SID: 'string',
  CHAT_SERVICE_SID: 'Ws2xxxxxx',
  ASELO_APP_ACCESS_KEY: 'AW12xx2',
  ASELO_APP_SECRET_KEY: 'KA23xxx09i',
  AWS_REGION: 'us-east-1',
  TWILIO_WORKSPACE_SID: 'WE23xxx0orre',
  SURVEY_WORKFLOW_SID: 'AZexxx903esd',
  HELPLINE_CODE: 'AS',
  ENVIRONMENT: 'development',
};

const mockEvent: Body = {
  channelSid: 'SID123xxx09sa',
  message: 'Message sent',
  fromServiceUser: 'Test User',
  studioFlowSid: 'FL0123xxdew',
  language: 'en_US',
  type: 'pre_survey',
};

const mockCallback = jest.fn();
const lexResponse = { message: 'Lex response message' };

beforeAll(() => {
  const runtime = new helpers.MockRuntime(mockContext);
  // eslint-disable-next-line no-underscore-dangle
  runtime._addFunction('captureChannelWithBot', 'functions/captureChannelWithBot.protected');
  helpers.setup({}, runtime);
});

beforeEach(() => {
  const functions = {
    'helpers/lexClient': {
      path: '../functions/helpers/lexClient.private.ts',
    },
  };

  const getFunctionsMock = jest.fn().mockReturnValue(functions);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  global.Runtime.getFunctions = () => getFunctionsMock();

  lexClient.postText = jest.fn().mockResolvedValue(lexResponse);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('captureChannelWithBot', () => {
  test('should return lexResonse, update channel, and resolve with succes', async () => {
    const event: Body = {
      channelSid: 'SID123xxx09sa',
      message: 'Message sent',
      fromServiceUser: 'Test User',
      studioFlowSid: 'FL0123xxdew',
      language: 'en_US',
      type: 'pre_survey',
    };
    await captureChannelWithBot(mockContext, event, mockCallback);

    expect(mockCallback).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        _body: 'Channel captured by bot =)',
        _statusCode: 200,
      }),
    );
  });
  //  We need to ignore the typescript error since channelSid is required.
  //  Same apply to others

  test('should resolve with error message when channelSid is missing', async () => {
    const event = { ...mockEvent, channelSid: undefined };

    // @ts-ignore
    await captureChannelWithBot(mockContext, event, mockCallback);

    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Error: channelSid parameter not provided',
          status: 400,
        }),
        _statusCode: 400,
      }),
    );
  });

  test('should resolve with error message when message is missing', async () => {
    const event = { ...mockEvent, message: undefined };

    // @ts-ignore
    await captureChannelWithBot(mockContext, event, mockCallback);

    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Error: message parameter not provided',
          status: 400,
        }),
        _statusCode: 400,
      }),
    );
  });

  test('should resolve with error message when fromServiceUser is missing', async () => {
    const event = { ...mockEvent, fromServiceUser: undefined };

    // @ts-ignore
    await captureChannelWithBot(mockContext, event, mockCallback);

    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Error: fromServiceUser parameter not provided',
          status: 400,
        }),
        _statusCode: 400,
      }),
    );
  });

  test('should resolve with error message when studioFlowSid is missing', async () => {
    const event = { ...mockEvent, studioFlowSid: undefined };

    // @ts-ignore
    await captureChannelWithBot(mockContext, event, mockCallback);

    expect(lexClient.postText).not.toHaveBeenCalled();
    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: expect.objectContaining({
          message: 'Error: studioFlowSid parameter not provided',
          status: 400,
        }),
        _statusCode: 400,
      }),
    );
  });
});
