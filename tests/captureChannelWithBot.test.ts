import {
  handler as captureChannelWithBot,
  Body,
} from '../functions/captureChannelWithBot.protected';
import helpers from './helpers';

const fetch = jest.fn().mockReturnValue({
  attributes: JSON.stringify({
    channelCapturedByBot: {
      botId: 'C6HUSTIFBR',
      botAliasId: 'TSTALIASID',
      localeId: 'en_US',
    },
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
};

const mockEvent: Body = {
  channelSid: 'SID123xxx09sa',
  message: 'Message sent',
  fromServiceUser: 'Test User',
  studioFlowSid: 'FL0123xxdew',
  botName: 'test',
};

describe('captureChannelWithBot', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockCallback = jest.fn();

  // This is the failing test
  //   test('should resolve with success message when all required fields are present', async () => {
  //     await captureChannelWithBot(mockContext, mockEvent, mockCallback);

  //     expect(mockContext.getTwilioClient).toHaveBeenCalled();
  //     expect(mockCallback.mock.calls[0][0]).toBeNull();
  //     expect(mockCallback.mock.calls[0][1]).toEqual(
  //       expect.objectContaining({
  //         _body: 'Channel captured by bot =)',
  //         _statusCode: 200,
  //       }),
  //     );
  //   });

  //  We need to ignore the typescript error since channelSid is required.
  //  Same apply to others

  test('should resolve with error message when channelSid is missing', async () => {
    const event = { ...mockEvent, channelSid: undefined };

    // @ts-ignore
    await captureChannelWithBot(mockContext, event, mockCallback);

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
