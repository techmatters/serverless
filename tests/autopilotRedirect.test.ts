import { ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import { handler as autopilotRedirect, Event } from '../functions/autopilotRedirect.protected';

import helpers from './helpers';

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
};

describe('Redirect forwards to the correct task', () => {
  beforeAll(() => {
    helpers.setup({});
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should forward normal surveys to a counselor', () => {
    const event: Event = {
      Memory: `{
                "twilio": {
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

    expect(autopilotRedirect(baseContext, event, callback));
  });

  test('Should forward the Why gender to the answer', () => {
    const event: Event = {
      Memory: `{
                "twilio": {
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
                                    "answer": "why"
                                }
                            }
                        }
                    }
                },
                "at": "survey"
            }`,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toMatchObject({ actions: [{ redirect: 'task://gender_why' }] });
      expect(err).toBeNull();
    };

    expect(autopilotRedirect(baseContext, event, callback));
  });

  test('Should forward all regular gender_why responses to a counselor', () => {
    const event: Event = {
      Memory: `{
                  "twilio": {
                      "collected_data": {
                          "collect_survey": {
                              "answers": {
                                  "about_self": {
                                      "answer": "No"
                                  },
                                  "age": {
                                      "answer": "23"
                                  },
                                  "gender": {
                                      "answer": "Boy"
                                  }
                              }
                          }
                      }
                  },
                  "at": "gender_why"
              }`,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
    };

    expect(autopilotRedirect(baseContext, event, callback));
  });

  test('Should forward non-responses to why, even with autopilot weirdness, to a counselor', () => {
    const event: Event = {
      Memory: `{
                "twilio": {
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
                                    "answer": "why",
                                    "error": {
                                      "message": "Invalid Value",
                                      "value": "prefer not to answer"
                                    }
                                }
                            }
                        }
                    }
                },
                "at": "gender_why"
            }`,
    };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toMatchObject({ actions: [{ redirect: 'task://counselor_handoff' }] });
      expect(err).toBeNull();
    };

    expect(autopilotRedirect(baseContext, event, callback));
  });
});
