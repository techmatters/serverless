# serverless
Repository for serverless functions living on the Twilio Serverless Toolkit

## Local development

1- Clone repository:  
`git clone https://github.com/tech-matters/serverless && cd serverless`  
2- Install dependencies:  
`npm install`  
3- create a .env file with propper ACCOUNT_SID=<AUTH_TOKEN> AUTH_TOKEN=<AUTH_TOKEN> (can be found inside the twilio console, depending on the enviroment we want to deploy to)  
4- run typescript compiler (as Twilio ST serves the .js files) and start local server:  
`npm start`  

For help on twilio-run commands rur:  
`npm run tr -- help`  
   
To deploy:  
`npm run tr -- deploy`  


