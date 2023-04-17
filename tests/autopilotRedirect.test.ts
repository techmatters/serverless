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
import { handler as autopilotRedirect, Event } from '../functions/autopilotRedirect.protected';

import helpers from './helpers';

const users: { [u: string]: any } = {
  user: {
    attributes: '{}',
    update: async (attributes: string) => {
      users.user = attributes;
    },
  },
};

const baseContext = {
  getTwilioClient: (): any => ({
    chat: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      services: (serviceSid: string) => ({
        channels: (channelSid: string) => {
          if (channelSid === 'web') {
            return {
              fetch: async () => ({
                attributes: '{"channel_type": "web"}',
              }),
            };
          }

          if (channelSid === 'failure') throw new Error('Something crashed');

          return {
            fetch: async () => ({
              attributes: '{}',
            }),
          };
        },
        users: (user: string) => ({
          fetch: async () => users[user],
        }),
      }),
    },
  }),
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('Redirect forwards to the correct task', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should forward normal surveys to a counselor (NO update to user as channel is not web)', async () => {
    const event: Event = {
      Channel: 'chat',
      CurrentTask: 'redirect_function',
      UserIdentifier: 'user',
      Memory: `{
                "twilio": {
                  "chat": { "ChannelSid": "not web" },
                    "collected_data": {
                        "collect_survey": {
                            "answers": {
                                "about_self": {
                                    "answer": "Yes"
                                },
                                "age": {
                                    "answer": "12"
                                },
                                "gender": {
                                    "answer": "Girl"
                                }
                            }
                        }
                    }
                },
                "at": "survey"
            }`,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      const expectedAttr = {};
      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
      expect(users.user.attributes).toBe(JSON.stringify(expectedAttr));
    };

    await autopilotRedirect(baseContext, event, callback);
  });

  test('Should forward normal surveys to a counselor (YES update to user as channel is web)', async () => {
    const event: Event = {
      Channel: 'chat',
      CurrentTask: 'redirect_function',
      UserIdentifier: 'user',
      Memory: `{
                "twilio": {
                    "chat": { "ChannelSid": "web" },
                    "collected_data": {
                        "collect_survey": {
                            "answers": {
                                "about_self": {
                                    "answer": "Yes"
                                },
                                "age": {
                                    "answer": "12"
                                },
                                "gender": {
                                    "answer": "Girl"
                                }
                            }
                        }
                    }
                },
                "at": "survey"
            }`,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      const expectedAttr = { lockInput: true };

      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
      expect(users.user.attributes).toBe(JSON.stringify(expectedAttr));
    };

    await autopilotRedirect(baseContext, event, callback);
  });

  test('Should forward handoff to counselor if something fails', async () => {
    const event: Event = {
      Channel: 'chat',
      CurrentTask: 'redirect_function',
      UserIdentifier: 'user',
      Memory: `{
                "twilio": {
                    "chat": { "ChannelSid": "failure" },
                    "collected_data": {
                        "collect_survey": {
                            "answers": {
                                "about_self": {
                                    "answer": "Yes"
                                },
                                "age": {
                                    "answer": "12"
                                },
                                "gender": {
                                    "answer": "Girl"
                                }
                            }
                        }
                    }
                },
                "at": "survey"
            }`,
      request: { cookies: {}, headers: {} },
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
    };

    await autopilotRedirect(baseContext, event, callback);
  });
});
