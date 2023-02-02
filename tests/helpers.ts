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

/* eslint-disable */
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const Twilio = require("twilio");

class MockRuntime {
  constructor(context) {
    this.context = context;
    this._assets = {};
    this._functions = {};
  }

  _addAsset(key, filePath) {
    const resolved = path.resolve(path.dirname(module.parent.filename), filePath);
    this._assets[key] = {
      path: resolved,
      open: () => fs.readFileSync(resolved)
    };
  }

  _missingAsset(key) {
    this._assets[key] = undefined;
  }

  _addFunction(key, filePath) {
    this._functions[key] = {
      path: path.resolve(filePath)
    };
  }

  getAssets() {
    if (Object.keys(this._assets).length === 0) {
      throw new Error("You must explicitly add assets using MockRuntime");
    }
    return this._assets;
  }

  getFunctions() {
    if (Object.keys(this._functions).length === 0) {
      throw new Error("You must explicitly add functions using MockRuntime");
    }
    return this._functions;
  }
}

class Response {
  constructor() {
    this._body = {};
    this._headers = {};
    this._statusCode = 200;
  }

  setBody(body) {
    this._body = body;
  }

  setStatusCode(code) {
    this._statusCode = code;
  }

  appendHeader(key, value) {
    this._headers[key] = value;
  }

  /**
   * @param {{[key: string]: string}} headers 
   */
  setHeaders(headers) {
    Object.entries(headers).forEach(([key, value]) => this.appendHeader(key, value));
  }

  getStatus() {
    return this._statusCode;
  }

  getBody() {
    return this._body;
  }
}

export type MockedResponse = Response;

const setup = (context = {}, runtime = new MockRuntime()) => {
  global.Twilio = Twilio;
  global.Twilio.Response = Response;
  if (context.ACCOUNT_SID && context.AUTH_TOKEN) {
    global.twilioClient = new Twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
  }
  global.Runtime = runtime;
};

const teardown = () => {
  delete global.Twilio;
  if (global.twilioClient) delete global.twilioClient;
  if (global.Runtime) delete global.Runtime;
};

const backupEnv = () => {
  return {...process.env};
};

const restoreEnv = (backupEnv) => {
  for (let key of Object.keys(process.env)) {
    if (backupEnv[key] === undefined) {
      delete process.env[key];
    }
  }
  for (let key of Object.keys(backupEnv)) {
    process.env[key] = backupEnv[key];
  }
};

export default {
  setup,
  teardown,
  MockRuntime,
  backupEnv,
  restoreEnv
};

