import each from 'jest-each';
import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import crypto from 'crypto';
import {
  handler as InstagramToFlex,
  Body,
} from '../../../functions/webhooks/instagram/InstagramToFlex';
import helpers, { MockedResponse } from '../../helpers';

const MOCK_CHANNEL_TYPE = 'instagram';
const MOCK_SENDER_CHANNEL_SID = `${MOCK_CHANNEL_TYPE}:sender_id`;
const MOCK_OTHER_CHANNEL_SID = `${MOCK_CHANNEL_TYPE}:other_id`;

const newChannel = (sid: string, messages: any[] = []) => {
  return {
    attributes: '{}',
    sid,
    messages: {
      create: jest.fn().mockResolvedValue(`Message sent in channel ${sid}.`),
      list: async () => messages,
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  };
};

const mockOneMessage = {
  sid: 'message_1',
  attributes: JSON.stringify({ messageExternalId: 'test_message_mid' }),
  update: jest.fn(),
};

const channels: { [x: string]: any } = {
  [MOCK_SENDER_CHANNEL_SID]: newChannel(MOCK_SENDER_CHANNEL_SID, [mockOneMessage]),
  [MOCK_OTHER_CHANNEL_SID]: newChannel(MOCK_OTHER_CHANNEL_SID),
};

let documents: any = {
  [MOCK_SENDER_CHANNEL_SID]: { data: { activeChannelSid: MOCK_SENDER_CHANNEL_SID } },
};

function documentsMock(doc: string) {
  return {
    fetch: async () => {
      if (!documents[doc]) throw new Error('Document does not exists');

      return documents[doc];
    },
  };
}

documentsMock.create = async ({ data, uniqueName }: { data: any; uniqueName: string }) => {
  documents = { ...documents, [uniqueName]: { data } };
  return documents[uniqueName];
};

let mockTwilioClient: any;

const baseContext = {
  getTwilioClient: (): any => mockTwilioClient,
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  AUTH_TOKEN: 'AUTH_TOKEN',
  SYNC_SERVICE_SID: 'SYNC_SERVICE_SID',
  CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
  INSTAGRAM_FLEX_FLOW_SID: 'INSTAGRAM_FLEX_FLOW_SID',
  FACEBOOK_APP_SECRET: 'test secret',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'test token',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

const defaultBodyAsString = 'fake body';
const expectedSignature = crypto
  .createHmac('sha1', baseContext.FACEBOOK_APP_SECRET)
  .update(defaultBodyAsString)
  .digest('hex');

const validEventBody = ({
  senderId = 'sender_id',
  recipientId = 'recipient_id',
  isDeleted = false,
  attachments = undefined,
}: {
  senderId?: string;
  recipientId?: string;
  isDeleted?: boolean;
  attachments?: any[];
} = {}): Body => ({
  object: 'instagram',
  bodyAsString: defaultBodyAsString,
  xHubSignature: `sha1=${expectedSignature}`,
  entry: [
    {
      time: 100,
      id: 'test_instagram_message',
      messaging: [
        {
          sender: {
            id: senderId,
          },
          recipient: {
            id: recipientId,
          },
          timestamp: 100,
          message: {
            mid: 'test_message_mid',
            text: 'test message text',
            is_deleted: isDeleted,
            attachments,
          },
        },
      ],
    },
  ],
});

describe('InstagramToFlex', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime(baseContext);
    // eslint-disable-next-line no-underscore-dangle
    runtime._addFunction(
      'helpers/customChannels/customChannelToFlex',
      'functions/helpers/customChannels/customChannelToFlex.private',
    );
    helpers.setup({}, runtime);
  });

  beforeEach(() => {
    mockTwilioClient = {
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
      flexApi: {
        channel: {
          create: jest
            .fn()
            .mockImplementation(
              async ({ flexFlowSid, identity }: { flexFlowSid: string; identity: string }) => {
                if (flexFlowSid === 'not-existing') throw new Error('Flex Flow does not exists.');
                return channels[identity];
              },
            ),
        },
      },
      sync: {
        services: () => ({
          documents: documentsMock,
        }),
      },
    };

    Object.entries(channels).forEach(([, c]) => c.messages.create.mockClear());
    mockOneMessage.update.mockClear();
  });

  afterAll(() => {
    helpers.teardown();
  });
  each([
    {
      conditionDescription: 'the event contains no signature',
      event: { ...validEventBody(), xHubSignature: undefined },
      expectedStatus: 403,
      expectedMessage: 'Unauthorized',
    },
    {
      conditionDescription: 'the event contains malformed signature',
      event: { ...validEventBody(), xHubSignature: expectedSignature },
      expectedStatus: 403,
      expectedMessage: 'Unauthorized',
    },
    {
      conditionDescription: 'the event contains an incorrect signature',
      event: {
        ...validEventBody(),
        xHubSignature: crypto
          .createHmac('sha1', baseContext.FACEBOOK_APP_SECRET)
          .update('BEEP BOOP')
          .digest('hex'),
      },
      expectedStatus: 403,
      expectedMessage: 'Unauthorized',
    },
    {
      conditionDescription: 'the event contains no entry',
      event: { ...validEventBody(), entry: [] },
      expectedStatus: 500,
      expectedMessage: 'Cannot read propert', // Node 12<= - 'property', Node 12> - 'properties' :-P
    },
    {
      conditionDescription: 'the event has an entry with empty messaging',
      event: { ...validEventBody(), entry: [{ ...validEventBody().entry[0], messaging: [] }] },
      expectedStatus: 500,
      expectedMessage: 'Cannot read propert', // Node 12<= - 'property', Node 12> - 'properties' :-P
    },
    {
      conditionDescription: 'the event has no sender',
      event: {
        ...validEventBody(),
        entry: [
          {
            ...validEventBody().entry[0],
            messaging: [{ ...validEventBody().entry[0].messaging[0], sender: undefined }],
          },
        ],
      },
      expectedStatus: 500,
      expectedMessage: 'Cannot read propert', // Node 12<= - 'property', Node 12> - 'properties' :-P
    },
    {
      conditionDescription: 'the event has no message',
      event: {
        ...validEventBody(),
        entry: [
          {
            ...validEventBody().entry[0],
            messaging: [{ ...validEventBody().entry[0].messaging[0], message: undefined }],
          },
        ],
      },
      expectedStatus: 500,
      expectedMessage: 'Cannot read propert', // Node 12<= - 'property', Node 12> - 'properties' :-P
    },
    {
      conditionDescription:
        'creating a channel and the flex flow identified in the INSTAGRAM_FLEX_FLOW_SID does not exist',
      event: validEventBody({ senderId: 'other_id' }),
      flexFlowSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Flex Flow does not exists',
      expectedToCreateChannel: MOCK_OTHER_CHANNEL_SID,
    },
    {
      conditionDescription:
        'creating a channel and the chat service identified in the CHAT_SERVICE_SID does not exist',
      event: validEventBody({ senderId: 'other_id' }),
      chatServiceSid: 'not-existing',
      expectedStatus: 500,
      expectedMessage: 'Service does not exists',
      expectedToCreateChannel: MOCK_OTHER_CHANNEL_SID,
    },
    {
      conditionDescription: 'the entry id and the message sender id are the same',
      event: { ...validEventBody(), entry: [{ ...validEventBody().entry[0], id: 'sender_id' }] },
      expectedStatus: 200,
      expectedMessage: 'Ignored event.',
    },
    {
      conditionDescription: 'sending to existing channel',
      event: validEventBody({}),
      expectedStatus: 200,
      expectedMessage: `Message sent in channel ${MOCK_SENDER_CHANNEL_SID}.`,
      expectedToBeSentOnChannel: MOCK_SENDER_CHANNEL_SID,
    },
    {
      conditionDescription: 'creating a new channel',
      event: validEventBody({ senderId: 'other_id' }),
      expectedStatus: 200,
      expectedMessage: `Message sent in channel ${MOCK_OTHER_CHANNEL_SID}.`,
      expectedToBeSentOnChannel: MOCK_OTHER_CHANNEL_SID,
      expectedToCreateChannel: MOCK_OTHER_CHANNEL_SID,
    },
    {
      conditionDescription: 'deleting a message from an inactive conversation',
      event: validEventBody({ senderId: 'no_active_chat', isDeleted: true }),
      expectedStatus: 200,
      expectedMessage:
        'Message unsent with external id test_message_mid is not part of an active conversation.',
      expectedToBeSentOnChannel: undefined,
      expectedToCreateChannel: undefined,
    },
    {
      conditionDescription: 'deleting a message from an active conversation',
      event: validEventBody({ senderId: 'sender_id', isDeleted: true }),
      expectedStatus: 200,
      expectedMessage: 'Message with external id test_message_mid unsent.',
      expectedToBeSentOnChannel: undefined,
      expectedToCreateChannel: undefined,
      expectedToDeleteMessage: true,
    },
    {
      conditionDescription: 'story tagging from an inactive conversation',
      event: validEventBody({
        senderId: 'no_active_chat',
        attachments: [{ type: 'story_mention', payload: { url: 'some fake url' } }],
      }),
      expectedStatus: 200,
      expectedMessage:
        'Story mention with external id test_message_mid is not part of an active conversation.',
      expectedToBeSentOnChannel: undefined,
      expectedToCreateChannel: undefined,
    },
    {
      conditionDescription: 'story tagging from an inactive conversation',
      event: validEventBody({
        senderId: 'sender_id',
        attachments: [{ type: 'story_mention', payload: { url: 'some fake url' } }],
      }),
      expectedStatus: 200,
      expectedMessage: `Message sent in channel ${MOCK_SENDER_CHANNEL_SID}.`,
      expectedToBeSentOnChannel: MOCK_SENDER_CHANNEL_SID,
      expectedToCreateChannel: undefined,
      expectedMessageText: 'Story mention: some fake url',
    },
  ]).test(
    "Should return expectedStatus '$expectedMessage' when $conditionDescription",
    async ({
      event,
      expectedStatus,
      expectedMessage,
      flexFlowSid = 'INSTAGRAM_FLEX_FLOW_SID',
      chatServiceSid = 'CHAT_SERVICE_SID',
      expectedToBeSentOnChannel,
      expectedToCreateChannel,
      expectedToDeleteMessage = false,
      expectedMessageText = undefined,
    }) => {
      let response: MockedResponse | undefined;

      const callback: ServerlessCallback = (err, result) => {
        response = result as MockedResponse | undefined;
      };
      await InstagramToFlex(
        { ...baseContext, INSTAGRAM_FLEX_FLOW_SID: flexFlowSid, CHAT_SERVICE_SID: chatServiceSid },
        event,
        callback,
      );

      expect(response).toBeDefined();
      if (response) {
        expect({
          status: response.getStatus(),
          message: expectedStatus === 200 ? response.getBody() : response.getBody().message,
        }).toMatchObject({
          status: expectedStatus,
          message: expect.stringContaining(expectedMessage),
        });
        if (expectedToBeSentOnChannel) {
          expect(channels[expectedToBeSentOnChannel].messages.create).toBeCalledWith(
            expect.objectContaining({
              body: expectedMessageText || 'test message text',
              from: expectedToBeSentOnChannel,
              xTwilioWebhookEnabled: 'true',
              attributes: JSON.stringify({ messageExternalId: 'test_message_mid' }),
            }),
          );
        } else {
          Object.values(channels).forEach((channel) => {
            expect(channel.messages.create).not.toBeCalled();
          });
        }
        if (expectedToCreateChannel) {
          expect(mockTwilioClient.flexApi.channel.create).toBeCalledWith(
            expect.objectContaining({
              flexFlowSid,
              identity: expectedToCreateChannel,
              target: expectedToCreateChannel,
              chatUserFriendlyName: expectedToCreateChannel,
              chatFriendlyName: expectedToCreateChannel,
            }),
          );
        } else {
          expect(mockTwilioClient.flexApi.channel.create).not.toBeCalled();
        }

        if (expectedToDeleteMessage) expect(mockOneMessage.update).toHaveBeenCalled();
      }
    },
  );
});
