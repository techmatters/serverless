/* eslint-disable no-underscore-dangle */
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
import each from 'jest-each';
import {
  handler as chatbotCallback,
  Body,
} from '../../functions/channelCapture/chatbotCallback.protected';
import helpers from '../helpers';
import * as lexClient from '../../functions/channelCapture/lexClient.private';
import * as channelCaptureHandlers from '../../functions/channelCapture/channelCaptureHandlers.private';

const mockCreateMessage = jest.fn();
const mockRemoveWebhook = jest.fn();

// Mocked before each test
let mockedChannel: any;
const defaultChannel = {
  sid: 'CH123',
  attributes: JSON.stringify({
    channelSid: 'CH123',
    serviceUserIdentity: 'serviceUserIdentity',
    capturedChannelAttributes: {
      botName: 'botName',
      botAlias: 'latest',
      localeId: 'en_US',
      userId: 'CH123',
      controlTaskSid: 'WT123',
      releaseType: 'triggerStudioFlow',
      studioFlowSid: 'SF123',
      chatbotCallbackWebhookSid: 'WH123',
      // memoryAttribute: ,
      // releaseFlag: ,
    },
  }),
  messages: () => ({
    create: mockCreateMessage,
  }),
  update: ({ attributes }: { attributes: string }) => ({
    ...mockedChannel,
    attributes,
  }),
  webhooks: () => ({
    get: () => ({
      remove: mockRemoveWebhook,
    }),
    // create: jest.fn(),
  }),
};

const context = {
  getTwilioClient: () => ({
    chat: {
      services: () => ({
        channels: () => ({
          fetch: () => mockedChannel,
        }),
      }),
    },
    taskrouter: {
      v1: {
        workspaces: () => ({
          tasks: () => ({
            update: jest.fn(),
          }),
        }),
      },
    },
  }),
  DOMAIN_NAME: 'DOMAIN_NAME',
  PATH: 'PATH',
  SERVICE_SID: 'SERVICE_SID',
  ENVIRONMENT_SID: 'ENVIRONMENT_SID',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  ASELO_APP_ACCESS_KEY: 'ASELO_APP_ACCESS_KEY',
  ASELO_APP_SECRET_KEY: 'ASELO_APP_SECRET_KEY',
  AWS_REGION: 'us-east-1',
  TWILIO_WORKSPACE_SID: 'TWILIO_WORKSPACE_SID',
  HRM_STATIC_KEY: 'HRM_STATIC_KEY',
  HELPLINE_CODE: 'HELPLINE_CODE',
  ENVIRONMENT: 'ENVIRONMENT',
  SURVEY_WORKFLOW_SID: 'SURVEY_WORKFLOW_SID',
};

beforeAll(() => {
  const runtime = new helpers.MockRuntime(context);
  runtime._addFunction('channelCapture/lexClient', 'functions/channelCapture/lexClient.private');
  runtime._addFunction(
    'channelCapture/channelCaptureHandlers',
    'functions/channelCapture/channelCaptureHandlers.private',
  );
  helpers.setup({}, runtime);
});
beforeEach(() => {
  mockedChannel = defaultChannel;
});
afterAll(() => {
  helpers.teardown();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('chatbotCallback', () => {
  each([
    {
      event: {
        Body: 'Test body',
        From: 'serviceUserIdentity',
        ChannelSid: 'CH123',
        EventType: 'onSomeOtherEvent',
      },
      whenDescription: 'EventType is not onMessageSent',
    },
    {
      event: {
        Body: 'Test body',
        From: 'someOtherUser',
        ChannelSid: 'CH123',
        EventType: 'onMessageSent',
      },
      whenDescription: 'From is not serviceUserIdentity',
    },
  ]).test('$whenDescription, ignore the event', async ({ event }) => {
    const postTextSpy = jest.spyOn(lexClient, 'postText');
    const updateChannelSpy = jest.spyOn(mockedChannel, 'update');

    await chatbotCallback(context as any, event, () => {});

    expect(postTextSpy).not.toHaveBeenCalled();
    expect(updateChannelSpy).not.toHaveBeenCalled();
    expect(mockRemoveWebhook).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  test('when Lex response is not end of dialog, only redirect message to the channel', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'serviceUserIdentity',
      ChannelSid: 'CH123',
      EventType: 'onMessageSent',
    };

    const postTextSpy = jest.spyOn(lexClient, 'postText').mockImplementation(
      async () =>
        ({
          dialogState: 'ElicitIntent',
          message: 'Some response from Lex',
        } as any),
    );
    const updateChannelSpy = jest.spyOn(mockedChannel, 'update');

    await chatbotCallback(context as any, event, () => {});

    expect(postTextSpy).toHaveBeenCalledWith(context, {
      botName: 'botName',
      botAlias: 'latest',
      userId: 'CH123',
      inputText: event.Body,
    });
    expect(updateChannelSpy).not.toHaveBeenCalled();
    expect(mockRemoveWebhook).not.toHaveBeenCalled();
    expect(mockCreateMessage).toHaveBeenCalledWith({
      body: 'Some response from Lex',
      from: 'Bot',
      xTwilioWebhookEnabled: 'true',
    });
  });

  each([
    {
      dialogState: 'Fulfilled',
    },
    {
      dialogState: 'Failed',
    },
  ]).test(
    'when Lex response is $dialogState, redirect message and run release channel handlers',
    async ({ dialogState }) => {
      const event: Body = {
        Body: 'Test body',
        From: 'serviceUserIdentity',
        ChannelSid: 'CH123',
        EventType: 'onMessageSent',
      };

      const memory = {
        attribute1: 'attribute1',
        attribute2: 'attribute2',
      };

      const { capturedChannelAttributes, ...channelAttributes } = JSON.parse(
        mockedChannel.attributes,
      );

      const postTextSpy = jest.spyOn(lexClient, 'postText').mockImplementation(
        async () =>
          ({
            dialogState,
            message: 'Some response from Lex',
            slots: memory,
          } as any),
      );
      const deleteSessionSpy = jest
        .spyOn(lexClient, 'deleteSession')
        .mockImplementation(() => Promise.resolve() as any);
      const updateChannelSpy = jest.spyOn(mockedChannel, 'update');
      const handleChannelReleaseSpy = jest
        .spyOn(channelCaptureHandlers, 'handleChannelRelease')
        .mockImplementation(() => Promise.resolve());

      await chatbotCallback(context as any, event, () => {});

      expect(postTextSpy).toHaveBeenCalledWith(context, {
        botName: 'botName',
        botAlias: 'latest',
        userId: 'CH123',
        inputText: event.Body,
      });
      expect(deleteSessionSpy).toHaveBeenCalledWith(context, {
        botName: 'botName',
        botAlias: 'latest',
        userId: 'CH123',
      });
      expect(updateChannelSpy).toHaveBeenCalledWith({
        attributes: JSON.stringify({
          ...channelAttributes,
          memory,
        }),
      });
      expect(mockRemoveWebhook).toHaveBeenCalled();
      expect(handleChannelReleaseSpy).toHaveBeenCalledWith(
        context,
        mockedChannel,
        capturedChannelAttributes,
        memory,
      );
      expect(mockCreateMessage).toHaveBeenCalledWith({
        body: 'Some response from Lex',
        from: 'Bot',
        xTwilioWebhookEnabled: 'true',
      });
    },
  );

  test('when releaseFlag is set, channel attributes contain "releaseFlag: true"', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'serviceUserIdentity',
      ChannelSid: 'CH123',
      EventType: 'onMessageSent',
    };

    const memory = {
      attribute1: 'attribute1',
      attribute2: 'attribute2',
    };

    const { capturedChannelAttributes, ...channelAttributes } = JSON.parse(
      mockedChannel.attributes,
    );

    mockedChannel = {
      ...defaultChannel,
      attributes: JSON.stringify({
        ...channelAttributes,
        capturedChannelAttributes: { ...capturedChannelAttributes, releaseFlag: 'releaseFlag' },
      }),
    };

    const updateChannelSpy = jest.spyOn(mockedChannel, 'update');

    jest.spyOn(lexClient, 'postText').mockImplementation(
      async () =>
        ({
          dialogState: 'Fulfilled',
          message: 'Some response from Lex',
          slots: memory,
        } as any),
    );
    jest.spyOn(lexClient, 'deleteSession').mockImplementation(() => Promise.resolve() as any);
    jest
      .spyOn(channelCaptureHandlers, 'handleChannelRelease')
      .mockImplementation(() => Promise.resolve());

    await chatbotCallback(context as any, event, () => {});

    expect(updateChannelSpy).toHaveBeenCalledWith({
      attributes: JSON.stringify({
        ...channelAttributes,
        memory,
        releaseFlag: true,
      }),
    });
  });

  test('when memoryAttribute is set, channel attributes contain "[memoryAttribute]: memory"', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'serviceUserIdentity',
      ChannelSid: 'CH123',
      EventType: 'onMessageSent',
    };

    const memory = {
      attribute1: 'attribute1',
      attribute2: 'attribute2',
    };

    const { capturedChannelAttributes, ...channelAttributes } = JSON.parse(
      mockedChannel.attributes,
    );

    mockedChannel = {
      ...defaultChannel,
      attributes: JSON.stringify({
        ...channelAttributes,
        capturedChannelAttributes: {
          ...capturedChannelAttributes,
          memoryAttribute: 'memoryAttribute',
        },
      }),
    };

    const updateChannelSpy = jest.spyOn(mockedChannel, 'update');

    jest.spyOn(lexClient, 'postText').mockImplementation(
      async () =>
        ({
          dialogState: 'Fulfilled',
          message: 'Some response from Lex',
          slots: memory,
        } as any),
    );
    jest.spyOn(lexClient, 'deleteSession').mockImplementation(() => Promise.resolve() as any);
    jest
      .spyOn(channelCaptureHandlers, 'handleChannelRelease')
      .mockImplementation(() => Promise.resolve());

    await chatbotCallback(context as any, event, () => {});

    expect(updateChannelSpy).toHaveBeenCalledWith({
      attributes: JSON.stringify({
        ...channelAttributes,
        memoryAttribute: memory,
      }),
    });
  });
});
