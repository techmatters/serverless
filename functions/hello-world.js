"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("@twilio-labs/serverless-runtime-types");
exports.handler = function (context, event, callback) {
    var twiml = new Twilio.twiml.VoiceResponse();
    twiml.say('Hello World!');
    callback(null, twiml);
};
