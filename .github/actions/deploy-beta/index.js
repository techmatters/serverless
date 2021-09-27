/**
 * If changes are made to this file, it needs to be recompiled using @vercel/ncc (https://github.com/vercel/ncc).
 * 1) Install vercel/ncc by running this command in your terminal. npm i -g @vercel/ncc
 * 2) Compile your index.js file. ncc build index.js --license licenses.txt
 * For details see https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action#commit-tag-and-push-your-action-to-github 
 */ 

import { setOutput, setFailed } from '@actions/core';
import fetch from 'node-fetch';

async function healthCheck () {
    // `who-to-greet` input defined in action metadata file
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  
    if(!twilioAccountSid || !twilioAuthToken) throw new Error('Account sid or auth token not provided.')
  
    const client = require('twilio')(twilioAccountSid, twilioAuthToken);
    const service = await client.serverless.services('serverless').fetch();
    const productionEnv = (await service.environments().list()).find(e => e.domainSuffix === 'production');
  
    const url = `https://${productionEnv.domainName}/healthCheck`;
  
    console.log('Attempting health check against ', url);
    const response = await fetch(url);
  
    if(!response.ok) throw new Error(`Error: response status is ${response.status}`);  
}

healthCheck()
.then(() => {
  console.log('Success!!')
  setOutput("Success", true);
})
.catch((err) => {
  console.log(err);
  setFailed(err.message);
});
