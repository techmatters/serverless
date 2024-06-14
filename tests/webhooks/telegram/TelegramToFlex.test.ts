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
import {
  Body,
  EnvVars,
  handler,
  TELEGRAM_BOT_API_SECRET_TOKEN_HEADER,
} from '../../../functions/webhooks/telegram/TelegramToFlex';

const conversations: { [x: string]: RecursivePartial<ConversationContext> } = {
  'telegram:sender_id': {
    fetch: async () => ({
      attributes: '{}',
      sid: 'CH_TELEGRAM_CONVERSATION_SID',
    }),
    messages: {
      create: async () => 'Message sent in channel line:sender_id.',
    },
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
  'line:other_id': {
    fetch: async () => ({
      attributes: '{}',
      sid: 'CH_OTHER_TELEGRAM_CONVERSATION_SID',
    }),
    webhooks: {
      create: async () => {},
    },
    update: async () => {},
  },
};

const baseContext: Context<EnvVars> = {
  getTwilioClient: ((): RecursivePartial<Twilio> => ({
    conversations: {
      conversations: {
        get: (conversationSid: ConversationSid) => {
          if (!conversations[conversationSid]) throw new Error('Conversation does not exists.');

          return conversations[conversationSid];
        },
        create(item: ConversationInstance): Promise<ConversationInstance> {
          return Promise.resolve(item);
        },
      },
    },
  })) as () => Twilio,
  DOMAIN_NAME: 'serverless',
  ACCOUNT_SID: 'ACCOUNT_SID',
  TELEGRAM_STUDIO_FLOW_SID: 'TELEGRAM_STUDIO_FLOW_SID',
  TELEGRAM_BOT_API_SECRET_TOKEN: 'TELEGRAM_BOT_API_SECRET_TOKEN',
  TELEGRAM_FLEX_BOT_TOKEN: 'TELEGRAM_FLEX_BOT_TOKEN',
  PATH: '',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

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

const BASELINE_EVENT: Body = {
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

test('The secret token header is not set - 403', async () => {
  const event: Body = {
    ...BASELINE_EVENT,
    request: { headers: {} },
  };
  const callback = jest.fn();
  await handler(baseContext, event, callback);

  const response: MockedResponse = callback.mock.calls[0][1];
  expect(response.getStatus()).toBe(403);
});
