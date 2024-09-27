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

import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { Event as Body } from '../../functions/helpers/sendErrorMessageForUnsupportedMedia.private';
import { handler as serviceConversationListener } from '../../functions/webhooks/serviceConversationListener.protected';
import helpers, { MockedResponse } from '../helpers';

const baseContext = {
  getTwilioClient: (): any => ({
    conversations: {
      conversations: {
        get: () => {},
      },
    },
  }),
  DOMAIN_NAME: 'serverless',
  CHAT_SERVICE_SID: 'chatService',
  SYNC_SERVICE_SID: 'SYNC_SERVICE_SID',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('serviceConversationListener', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime(baseContext);
    // eslint-disable-next-line no-underscore-dangle
    runtime._addFunction(
      'helpers/sendErrorMessageForUnsupportedMedia',
      'functions/helpers/sendErrorMessageForUnsupportedMedia.private',
    );
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  // TODO: Test coverage for sending error message

  test('Should return status 200 for valid message', async () => {
    const event1: Body = {
      Body: 'Test word',
      ConversationSid: 'CHxxxxxxx34EWS',
      EventType: 'onMessageAdded',
      Media: {},
      DateCreated: new Date(),
    };

    const callback1: ServerlessCallback = (err, result) => {
      expect(result).toBeDefined();
      const response = result as MockedResponse;
      expect(response.getStatus()).toBe(200);
    };

    await serviceConversationListener(baseContext, event1, callback1);
  });
});
