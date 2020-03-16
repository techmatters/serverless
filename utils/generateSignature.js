// eslint-disable-next-line import/no-extraneous-dependencies
const { getExpectedTwilioSignature } = require('twilio/lib/webhooks/webhooks');
// The get/post parameters in the Twilio's request
const params = require('./params.json');

// Twilio's secret key
const authToken = process.env.AUTH_TOKEN;

// The Twilio api endpoint and intended method
let url = process.env.ENDPOINT;
const method = process.env.METHOD; // GET or POST

if (method === 'GET') {
  url += `?${Object.keys(params)
    .map(key => `${key}=${params[key]}`)
    .join('&')}`;
}

const signature = getExpectedTwilioSignature(authToken, url, method === 'GET' ? {} : params);

// This is the signature we should include in the "X-Twilio-Signature" header
// eslint-disable-next-line no-console
console.log(signature);
