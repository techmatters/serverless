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
import { Twilio } from 'twilio';
import { Context } from '@twilio-labs/serverless-runtime-types/types';
import helpers, { MockedResponse, RecursivePartial } from '../../helpers';
import { ConversationSid } from '../../../functions/helpers/customChannels/customChannelToFlex.private';
import { Event as Body, EnvVars, handler } from '../../../functions/webhooks/modica/ModicaToFlex';

const CH_NEW_MODICA_CONVERSATION_SID = 'CH_NEW_MODICA_CONVERSATION_SID';
const CH_EXISTING_MODICA_CONVERSATION_SID = 'CH_EXISTING_MODICA_CONVERSATION_SID';
let conversations: { [x: string]: RecursivePartial<ConversationContext> };

let baseContext: Context<EnvVars> = {} as Context<EnvVars>;

let baseTwilioClient: RecursivePartial<Twilio> = {};

let baseEvent: Body;

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
    CH_NEW_MODICA_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: CH_NEW_MODICA_CONVERSATION_SID,
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
    CH_EXISTING_MODICA_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: CH_EXISTING_MODICA_CONVERSATION_SID,
      }),
      messages: {
        create: jest.fn().mockImplementation(async () => ({ response: 'property' })),
      },
    },
    CH_OTHER_MODICA_CONVERSATION_SID: {
      fetch: async () => ({
        attributes: '{}',
        sid: 'CH_OTHER_MODICA_CONVERSATION_SID',
      }),
    },
  };

  baseTwilioClient = {
    conversations: {
      conversations: {
        get: (conversationSid: ConversationSid) => {
          if (!conversations[conversationSid]) throw new Error('Conversation does not exists.');

          return conversations[conversationSid];
        },
        create: jest.fn().mockImplementation((item) =>
          Promise.resolve({
            ...item,
            sid: CH_NEW_MODICA_CONVERSATION_SID,
          } as ConversationInstance),
        ),
      },
      participantConversations: {
        list: async () =>
          Promise.resolve([
            {
              conversationSid: CH_EXISTING_MODICA_CONVERSATION_SID,
              conversationState: 'active',
            },
          ]),
      },
    },
  };

  baseContext = {
    getTwilioClient: ((): RecursivePartial<Twilio> => baseTwilioClient) as () => Twilio,
    DOMAIN_NAME: 'serverless',
    ACCOUNT_SID: 'ACCOUNT_SID',
    MODICA_STUDIO_FLOW_SID: 'MODICA_STUDIO_FLOW_SID',
    PATH: '',
    SERVICE_SID: undefined,
    ENVIRONMENT_SID: undefined,
    CHAT_SERVICE_SID: 'CHAT_SERVICE_SID',
    SYNC_SERVICE_SID: 'SYNC_SERVICE_SID',
    MODICA_FLEX_FLOW_SID: 'MODICA_FLEX_FLOW_SID',
    MODICA_TWILIO_MESSAGING_MODE: 'conversations',
  };

  baseEvent = {
    source: 'modica_source',
    destination: 'modica_destination',
    content: 'Modica message text',
  };
});

const verifyConversationCreation = () => {
  const mockTwilioClient = baseTwilioClient as Twilio;
  expect(mockTwilioClient.conversations.conversations.create as jest.Mock).toHaveBeenCalledWith({
    xTwilioWebhookEnabled: 'true',
    friendlyName: baseEvent.source,
    uniqueName: expect.stringMatching(`modica/modica:${baseEvent.source}/[0-9]+`),
  });
  const conversation = conversations.CH_NEW_MODICA_CONVERSATION_SID! as ConversationContext;

  expect(conversation.participants.create).toHaveBeenCalledWith({
    identity: `modica:${baseEvent.source}`,
  });

  expect(conversation.update).toHaveBeenCalledWith({
    state: 'active',
    timers: {
      closed: expect.any(String),
    },
    attributes: JSON.stringify({
      channel_type: 'modica',
      channelType: 'modica',
      senderScreenName: 'child',
      twilioNumber: `modica:${baseEvent.destination}`,
    }),
  });

  expect(conversation.webhooks.create).toHaveBeenCalledTimes(2);
  const { calls } = (conversation.webhooks.create as jest.Mock).mock;

  expect(calls[0][0]).toStrictEqual({
    target: 'studio',
    configuration: {
      flowSid: baseContext.MODICA_STUDIO_FLOW_SID,
      filters: ['onMessageAdded'],
    },
  });
  expect(calls[1][0]).toStrictEqual({
    target: 'webhook',
    configuration: {
      method: 'POST',
      url: `https://serverless/webhooks/modica/FlexToModica?recipientId=${baseEvent.source}`,
      filters: ['onMessageAdded'],
    },
  });
};

const verifyMessageCreation = (conversationSid: ConversationSid) => {
  const conversation = conversations[conversationSid] as ConversationContext;
  expect(conversation.messages.create).toHaveBeenCalledWith({
    body: 'Modica message text',
    author: `modica:${baseEvent.source}`,
    xTwilioWebhookEnabled: 'true',
  });
};

test('No existing conversation found - creates one before sending a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      ...baseTwilioClient.conversations,
      participantConversations: {
        list: async () => Promise.resolve([]),
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  verifyConversationCreation();
  verifyMessageCreation(CH_NEW_MODICA_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});

test('Existing conversation closed found - creates a new one before sending a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      ...baseTwilioClient.conversations,
      participantConversations: {
        list: async () =>
          Promise.resolve([
            {
              conversationSid: CH_EXISTING_MODICA_CONVERSATION_SID,
              conversationState: 'closed',
            },
            {
              conversationSid: 'CH_OTHER_MODICA_CONVERSATION_SID',
              conversationState: 'closed',
            },
          ]),
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  verifyConversationCreation();
  verifyMessageCreation(CH_NEW_MODICA_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});

test('Existing active conversation found - sends a message to it', async () => {
  baseTwilioClient = {
    ...baseTwilioClient,
    conversations: {
      ...baseTwilioClient.conversations,
      participantConversations: {
        list: async () =>
          Promise.resolve([
            {
              conversationSid: CH_EXISTING_MODICA_CONVERSATION_SID,
              conversationState: 'active',
            },
            {
              conversationSid: 'CH_OTHER_MODICA_CONVERSATION_SID',
              conversationState: 'closed',
            },
          ]),
      },
    },
  };

  const callback = jest.fn();
  await handler(baseContext, baseEvent, callback);
  const mockTwilioClient = baseTwilioClient as Twilio;
  expect(mockTwilioClient.conversations.conversations.create).not.toHaveBeenCalled();
  verifyMessageCreation(CH_EXISTING_MODICA_CONVERSATION_SID);
  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(200);
});
