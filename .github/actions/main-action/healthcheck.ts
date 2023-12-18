/**
 * Copyright (C) 2021-2023 Technology Matters
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see https://www.gnu.org/licenses/.
 */

/**
 * If changes are made to this file, it needs to be recompiled using @vercel/ncc (https://github.com/vercel/ncc).
 * 1) Install vercel/ncc by running this command in your terminal. npm i -g @vercel/ncc
 * 2) Compile your index.js file. ncc build index.js --license licenses.txt
 * For details see https://docs.github.com/en/actions/creating-actions/creating-a-javascript-action#commit-tag-and-push-your-action-to-github 
 */ 

import { setOutput, setFailed } from '@actions/core';
import fetch from 'node-fetch';
import Twilio from 'twilio';

async function healthCheck () {
    // `who-to-greet` input defined in action metadata file
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  
    if(!twilioAccountSid || !twilioAuthToken) throw new Error('Account sid or auth token not provided.')
  
    const client = Twilio(twilioAccountSid, twilioAuthToken);
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
