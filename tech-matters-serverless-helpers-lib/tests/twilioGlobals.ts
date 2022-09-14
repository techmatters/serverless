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