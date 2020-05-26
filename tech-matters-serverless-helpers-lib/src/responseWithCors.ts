import '@twilio-labs/serverless-runtime-types';

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
