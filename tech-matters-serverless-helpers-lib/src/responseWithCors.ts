import '@twilio-labs/serverless-runtime-types';

/**
 * Returns a Twilio Response object with the following http headers:
 * - Access-Control-Allow-Origin: *,
 * - Access-Control-Allow-Methods: OPTIONS, POST, GET,
 * - Access-Control-Allow-Headers: Content-Type,
 * - Content-Type: application/json,
 */
const responseWithCors = () => {
  const response = new Twilio.Response();

  response.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });

  return response;
};

export default responseWithCors;
