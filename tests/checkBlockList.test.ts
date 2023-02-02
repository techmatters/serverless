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
import { handler as checkBlockList, Event } from '../functions/checkBlockList.protected';

import helpers from './helpers';

const baseContext = {
  getTwilioClient: (): any => ({}),
  DOMAIN_NAME: 'serverless',
  PATH: 'PATH',
  SERVICE_SID: undefined,
  ENVIRONMENT_SID: undefined,
};

describe('checkBlockList defined', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    runtime._addAsset('/blocklist.json', '../assets/blocklist.private.json');
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should succeed with unblocked caller', () => {
    const event: Event = { callFrom: '+11234567890' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeUndefined();
      expect(err).toBeNull();
    };

    checkBlockList(baseContext, event, callback);
  });

  test('Should error with blocked caller', () => {
    const event: Event = { callFrom: '+12025550102' }; // fake 555 number
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const callback: ServerlessCallback = (a, b) => {};

    function blocked() {
      checkBlockList(baseContext, event, callback);
    }

    expect(blocked).toThrowError(new Error('User is blocked.'));
  });
});

describe('checkBlockList undefinied', () => {
  beforeAll(() => {
    const runtime = new helpers.MockRuntime({});
    // eslint-disable-next-line no-underscore-dangle
    runtime._missingAsset('/blocklist.json');
    helpers.setup({}, runtime);
  });
  afterAll(() => {
    helpers.teardown();
  });

  test('Should succeed with no blocklist', () => {
    const event: Event = { callFrom: '+11234567890' };

    const callback: ServerlessCallback = (err, result) => {
      expect(result).toBeUndefined();
      expect(err).toBeNull();
    };

    checkBlockList(baseContext, event, callback);
  });
});
