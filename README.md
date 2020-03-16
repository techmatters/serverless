# serverless
Repository for serverless functions living on the Twilio Serverless Toolkit

## Local development

1- Clone repository:  
`git clone https://github.com/tech-matters/serverless && cd serverless`  
2- Install dependencies:  
`npm install`  
3- create a .env file with propper ACCOUNT_SID=<account_sid_value> AUTH_TOKEN=<auth_token_value> (can be found inside the twilio console, depending on the enviroment we want to deploy to)  
4- run typescript compiler (as Twilio ST serves the .js files) and start local server:  
`npm start`  

For help on twilio-run commands run:  
`npm run tr -- help`  
   
To deploy:  
`npm run tr:deploy`  


## Testing protected apis
In order to test protected apis, we must provide a valid [X-Twilio-Signature](https://www.twilio.com/docs/usage/security) header to the api call.  
The signature can be generated with the /utils/generateSignature.js function.  
To use this utility:  
1- `cd utils`
2- Edit params.json file with the expected parameters (either it is a get or a post, the params can be added this way)  
3- Call the function with the auth token of the Twilio account that is serving the api, the api endpoint (without any url params, those should already be present in params.json) and the intended HTTP method (GET/POST):  
`AUTH_TOKEN=<auth_token_value> ENDPOINT=<twilio_serverless_api_endpoint> METHOD=<method> node generateSignature.js`  
The expected signature will be printed in the console. Note this signature will be different for every endpoint, params and method, as documented in Twilio's docs.