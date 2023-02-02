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

const Twilio = require('twilio');

class TwilioResponse {
  _body: any;
  _headers: {[key: string]: string};
  _statusCode: number;

  constructor() {
    this._body = {};
    this._headers = {};
    this._statusCode = 200;
  }

  setBody(body: any) {
    this._body = body;
  }

  setStatusCode(code: any) {
    this._statusCode = code;
  }

  appendHeader(key: string, value: string) {
    this._headers[key] = value;
  }

  setHeaders(headers: { [key: string]: string }) {
    Object.entries(headers).forEach(([key, value]) => this.appendHeader(key, value));
  }

  getStatus() {
    return this._statusCode;
  }

  getBody() {
    return this._body;
  }
}

export const setup = () => {
  global.Twilio = Twilio;
  // @ts-ignore
  global.Twilio.Response = TwilioResponse;
};

export const teardown = () => {
  // @ts-ignore
  delete global.Twilio;
}