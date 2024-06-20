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
  ConversationContext,
  ConversationInstance,
} from 'twilio/lib/rest/conversations/v1/conversation';
import twilio, { Twilio } from 'twilio';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import helpers, { MockedResponse, RecursivePartial } from '../../helpers';
import { ConversationSid } from '../../../functions/helpers/customChannels/customChannelToFlex.private';
import {
  Body,
  EnvVars,
  handler,
  TELEGRAM_BOT_API_SECRET_TOKEN_HEADER,
} from '../../../functions/webhooks/telegram/TelegramToFlex';

jest.mock('twilio', () => jest.fn());

const CH_NEW_TELEGRAM_CONVERSATION_SID = 'CH_NEW_TELEGRAM_CONVERSATION_SID';
const CH_EXISTING_TELEGRAM_CONVERSATION_SID = 'CH_EXISTING_TELEGRAM_CONVERSATION_SID';
let conversations: { [x: string]: RecursivePartial<ConversationContext> };

let baseContext: Context<EnvVars> = {} as Context<EnvVars>;

let baseTwilioClient: RecursivePartial<Twilio> = {};

let baseEvent: Body;

const mockTwilio = twilio as jest.MockedFunction<typeof twilio>;

beforeAll(() => {
  const runtime = new helpers.MockRuntime(baseContext);
  // eslint-disable-next-line no-underscore-dangle
  runtime._addFunction(
    'helpers/customChannels/customChannelToFlex',
    'functions/helpers/customChannels/customChannelToFlex.private',
  );
  helpers.setup({}, runtime);
});

afterAll(() => {
  helpers.teardown();
});

beforeEach(() => {
  jest.clearAllMocks();
  conversations = {
    CH_NEW_TELEGRAM_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: CH_NEW_TELEGRAM_CONVERSATION_SID,
      }),
      messages: {
        create: jest.fn().mockImplementation(async () => ({ response: 'property' })),
      },
      webhooks: {
        create: jest.fn(),
      },
      update: jest.fn(),
      participants: {
        create: jest.fn(),
      },
    },
    CH_EXISTING_TELEGRAM_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: CH_EXISTING_TELEGRAM_CONVERSATION_SID,
      }),
      messages: {
        create: jest.fn().mockImplementation(async () => ({ response: 'property' })),
      },
    },
    CH_OTHER_TELEGRAM_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: 'CH_OTHER_TELEGRAM_CONVERSATION_SID',
      }),
    },
  };

  baseTwilioClient = {
    conversations: {
      v1: {
        conversations: {
          get: (conversationSid: ConversationSid) => {
            if (!conversations[conversationSid]) throw new Error('Conversation does not exists.');

            return conversations[conversationSid];
          },
          create: jest.fn().mockImplementation((item) =>
            Promise.resolve({
              ...item,
              sid: CH_NEW_TELEGRAM_CONVERSATION_SID,
            } as ConversationInstance),
          ),
        },
        participantConversations: {
          list: async () =>
            Promise.resolve([
              {
                conversationSid: CH_EXISTING_TELEGRAM_CONVERSATION_SID,
                conversationState: 'active',
              },
            ]),
        },
      },
    },
  };

  mockTwilio.mockImplementation(() => baseTwilioClient as Twilio);

  baseContext = {
    getTwilioClient: jest.fn(),
    DOMAIN_NAME: 'serverless',
    ACCOUNT_SID: 'ACCOUNT_SID',
    AUTH_TOKEN: 'AUTH_TOKEN',
    TELEGRAM_STUDIO_FLOW_SID: 'TELEGRAM_STUDIO_FLOW_SID',
    TELEGRAM_BOT_API_SECRET_TOKEN: 'TELEGRAM_BOT_API_SECRET_TOKEN',
    TELEGRAM_FLEX_BOT_TOKEN: 'TELEGRAM_FLEX_BOT_TOKEN',
    PATH: '',
    SERVICE_SID: undefined,
    ENVIRONMENT_SID: undefined,
  };

  baseEvent = {
    message: {
      chat: {
        id: 'telegram_message_id',
        first_name: 'Tilly',
        username: 'tilly_grams',
      },
      text: 'Telegram message text',
    },
    request: {
      headers: {
        [TELEGRAM_BOT_API_SECRET_TOKEN_HEADER]: baseContext.TELEGRAM_BOT_API_SECRET_TOKEN,
      },
    },
  };
});

const verifyConversationCreation = () => {
  const mockTwilioClient = baseTwilioClient as Twilio;
  expect(mockTwilioClient.conversations.v1.conversations.create as jest.Mock).toHaveBeenCalledWith({
    xTwilioWebhookEnabled: 'true',
    friendlyName: baseEvent.message.chat.username,
    uniqueName: expect.stringMatching(`telegram/telegram:${baseEvent.message.chat.id}/[0-9]+`),
  });
  const conversation = conversations.CH_NEW_TELEGRAM_CONVERSATION_SID! as ConversationContext;

  expect(conversation.participants.create).toHaveBeenCalledWith({
    identity: `telegram:${baseEvent.message.chat.id}`,
  });

  expect(conversation.update).toHaveBeenCalledWith({
    state: 'active',
    'timers.closed': expect.any(String),
    attributes: JSON.stringify({
      channel_type: 'telegram',
      channelType: 'telegram',
      senderScreenName: baseEvent.message.chat.first_name,
      twilioNumber: `telegram:${baseContext.ACCOUNT_SID}`,
    }),
  });

  expect(conversation.webhooks.create).toHaveBeenCalledTimes(2);
  const { calls } = (conversation.webhooks.create as jest.Mock).mock;

  expect(calls[0][0]).toStrictEqual({
    target: 'studio',
    'configuration.flowSid': baseContext.TELEGRAM_STUDIO_FLOW_SID,
    'configuration.filters': ['onMessageAdded'],
  });
  expect(calls[1][0]).toStrictEqual({
    target: 'webhook',
    'configuration.method': 'POST',
    'configuration.url':
      'https://serverless/webhooks/telegram/FlexToTelegram?recipientId=telegram_message_id',
    'configuration.filters': ['onMessageAdded'],
  });
};

const verifyMessageCreation = (conversationSid: ConversationSid) => {
  const conversation = conversations[conversationSid] as ConversationContext;
  expect(conversation.messages.create).toHaveBeenCalledWith({
    body: 'Telegram message text',
    author: `telegram:${baseEvent.message.chat.id}`,
    xTwilioWebhookEnabled: 'true',
  });
};

test('The secret token header is not set - 403', async () => {
  const event: Body = {
    ...baseEvent,
    request: { headers: {} },
  };
  const callback = jest.fn();
  await handler(baseContext, event, callback);

  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(403);
});

test('The secret token header is set incorrectly - 403', async () => {
  const event: Body = {
    ...baseEvent,
    request: {
      headers: {
        [TELEGRAM_BOT_API_SECRET_TOKEN_HEADER]: 'wrongness',
      },
    },
  };
  const callback = jest.fn();
  await handler(baseContext, event, callback);

  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(403);
});

test('No existing conversation found - creates one before sending a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      v1: {
        ...baseTwilioClient!.conversations!.v1,
        ...baseTwilioClient.conversations,
        participantConversations: {
          list: async () => Promise.resolve([]),
        },
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  verifyConversationCreation();
  verifyMessageCreation(CH_NEW_TELEGRAM_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});

test('Existing conversation closed found - creates a new one before sending a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      v1: {
        ...baseTwilioClient!.conversations!.v1,
        participantConversations: {
          list: async () =>
            Promise.resolve([
              {
                conversationSid: CH_EXISTING_TELEGRAM_CONVERSATION_SID,
                conversationState: 'closed',
              },
              {
                conversationSid: 'CH_OTHER_TELEGRAM_CONVERSATION_SID',
                conversationState: 'closed',
              },
            ]),
        },
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  verifyConversationCreation();
  verifyMessageCreation(CH_NEW_TELEGRAM_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});

test('Existing active conversation found - sends a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      v1: {
        ...baseTwilioClient!.conversations!.v1,
        participantConversations: {
          list: async () =>
            Promise.resolve([
              {
                conversationSid: CH_EXISTING_TELEGRAM_CONVERSATION_SID,
                conversationState: 'active',
              },
              {
                conversationSid: 'CH_OTHER_TELEGRAM_CONVERSATION_SID',
                conversationState: 'closed',
              },
            ]),
        },
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  const mockTwilioClient = baseTwilioClient as Twilio;
  expect(mockTwilioClient.conversations.v1.conversations.create).not.toHaveBeenCalled();
  verifyMessageCreation(CH_EXISTING_TELEGRAM_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});
