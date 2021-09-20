/**
 * If changes are made to this file, it needs to be recompiled using @vercel/ncc (https://github.com/vercel/ncc).
 * 1) Install vercel/ncc by running this command in your terminal. npm i -g @vercel/ncc
 * 2) Compile your index.js file. ncc build index.js --license licenses.txt
 * For details see https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action#commit-tag-and-push-your-action-to-github 
 */ 

const core = require('@actions/core');
const fetch = require('node-fetch');

async function healthCheck () {
    // `who-to-greet` input defined in action metadata file
    const twilioAccountSid = core.getInput('account-sid');
    const twilioAuthToken = core.getInput('auth-token');
  
    if(!twilioAccountSid || !twilioAuthToken) throw new Error('Account sid or auth token not provided.')
  
    const client = require('twilio')(twilioAccountSid, twilioAuthToken);
    const service = await client.serverless.services('serverless').fetch();
    const productionEnv = (await service.environments().list()).find(e => e.domainSuffix === 'production');
  
    const url = `https://${productionEnv.domainName}/healthCheck`;
  
    const response = await fetch(url);
  
    if(!response.ok) throw new Error(`Error: response status is ${response.status}`);  
}

healthCheck()
.then(() => { core.setOutput("Success", true); })
.catch((err) => { core.setFailed(err.message); });
