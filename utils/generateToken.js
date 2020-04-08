// eslint-disable-next-line import/no-extraneous-dependencies
const { AccessToken } = require('twilio').jwt;

// Used when generating any kind of tokens
const twilioAccountSid = process.env.ACCOUNT_SID;
const twilioApiKey = process.env.AUTH_TOKEN;
const twilioApiSecret = process.env.SECRET;

if (!(twilioAccountSid && twilioApiKey && twilioApiSecret)) {
  throw new Error('Missing enviroment');
}
// Create an access token which we will sign and return to the client,
// containing the grant we just created
const token = new AccessToken(twilioAccountSid, twilioApiKey, twilioApiSecret);

// Serialize the token to a JWT string
console.log(token.toJwt());
