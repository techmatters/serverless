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
In order to test protected apis, we must provide a valid [JWT token](https://github.com/twilio/twilio-flex-token-validator) in the api's body call.  
The signature JWT must be obtained from within twilio flex.  
To run locally:  
1- `npm start`  
2- Change your Flex plugin serverless endpoint or hit the route via CURL:  
`curl -X GET '<twilio_serverless_api_endpoint_with_uri_params_if_any_and_valid_Token>'`  
Explanation  
"twilio_serverless_api_endpoint": the function endpoint (e.g. http://localhost:3000/yourFunction?)  
"with_uri_params_if_any": append to the uri "param1=<value1>&param2=<value2>"  
"and_valid_Token": finally append to the uri "Token=<valid_token>"  

Token generator util is a work in progress
