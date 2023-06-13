import {
  handler as chatbotCallback,
  Body,
} from '../../functions/webhooks/chatbotCallback.protected';
import helpers from '../helpers';

const context = {
  getTwilioClient: jest.fn().mockReturnValue({
    chat: {
      services: jest.fn().mockReturnValue({
        channels: jest.fn().mockReturnValue({
          fetch: jest.fn().mockResolvedValue({
            attributes: JSON.stringify({}),
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

describe('chatbotCallback', () => {
  beforeEach(() => {});

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

  it('should handle the event and send messages', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'Test from',
      ChannelSid: 'Test channelSid',
      EventType: 'onMessageSent',
    };

    await chatbotCallback(context, event, mockCallback);

    // Assert that the necessary functions were called with the correct arguments
    expect(context.getTwilioClient).toHaveBeenCalled();
    expect(context.getTwilioClient().chat.services).toHaveBeenCalledWith(context.CHAT_SERVICE_SID);
    expect(context.getTwilioClient().chat.services().channels).toHaveBeenCalledWith(
      event.ChannelSid,
    );
    expect(context.getTwilioClient().chat.services().channels().fetch).toHaveBeenCalled();
  });

  it('should handle the event and ignore it', async () => {
    const event: Body = {
      Body: 'Test body',
      From: 'Test from',
      ChannelSid: 'WA23xxx0ie',
      EventType: 'onMessageSent',
    };

    await chatbotCallback(context, event, mockCallback);

    expect(mockCallback.mock.calls[0][0]).toBeNull();
    expect(mockCallback.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        _body: 'Event ignored',
        _statusCode: 200,
      }),
    );
  });

  it('should resolve with error message when event is empty', async () => {
    const event = {};

    await chatbotCallback(context, event, mockCallback);

    // Assert that the necessary functions were called with the correct arguments
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

  it('should handle errors', async () => {
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
