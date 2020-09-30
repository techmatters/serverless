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
          if (channelSid === 'web')
            return {
              fetch: async () => ({
                attributes: '{"channel_type": "web"}',
              }),
            };

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
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
    };

    await autopilotRedirect(baseContext, event, callback);
  });
});
