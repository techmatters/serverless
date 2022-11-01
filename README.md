[![Actions Status](https://github.com/tech-matters/serverless/workflows/serverless-ci/badge.svg)](https://github.com/tech-matters/serverless/actions)

# serverless

Repository for serverless functions living on [Twilio Functions](https://www.twilio.com/docs/runtime/functions). Supports the [Aselo frontend](https://www.twilio.com/docs/flex/developer/plugins). See [aselo.org](https://aselo.org/) or [contact Aselo](https://aselo.org/contact-us/) for more information.

## git-secrets

In order to prevent sensitive credentials to be leaked, please follow this instructions to setup `git-secrets`.

- Install [git-secrets](https://github.com/awslabs/git-secrets) in your computer.
- Go into the repo root folder.
- Run `git secrets --register-aws`.
- Run `git config --local core.hooksPath .githooks/`.

## Local development

1- Clone repository:
`git clone https://github.com/tech-matters/serverless && cd serverless`
2- Install dependencies:
`npm ci`
3- create a .env file with all the .env variables ([below is the whole list](#environment-variables))
4- run typescript compiler (as Twilio ST serves the .js files) and start local server on port 3030:
`npm run start:local`

For help on twilio-run commands run:
`npm run tr -- help`

## Environment variables

| Variable Name                       | Expected Value                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT_SID`                       | sid of the Twilio account (under /project/settings)                                                                     |
| `AUTH_TOKEN`                        | auth token of the above account (under /project/settings)                                                               |
| `TWILIO_WORKSPACE_SID`              | workspace sid for the taskrouter (under /taskrouter/workspaces, named Flex Task Assignment)                             |
| `TWILIO_CHAT_TRANSFER_WORKFLOW_SID` | workflow sid within above workspace (under /taskrouter/workspaces/< above-workspace >/workflows, named Master Workflow) |
| `SYNC_SERVICE_SID`                  | sync service sid for use as temporary storage (under /sync/services, named Shared State Service)                        |
| `SYNC_SERVICE_API_KEY`              | api resource to use above sync client (under /sync/tools, named Shared State Service)                                   |
| `SYNC_SERVICE_API_SECRET`           | api secret of the above resource (no way to acces in Twilio console, ask this to the repo owner)                        |
| `CHAT_SERVICE_SID`                  | programmable chat sid used for chat tasks (under /chat/services, named Flex Chat Service)                               |

## Deployment

To deploy (dev environment): `npm run tr:deploy`
[More about deploying](https://www.twilio.com/docs/labs/serverless-toolkit/deploying)

## Testing protected apis

In order to test protected apis, we must provide a valid [JWT token](https://github.com/twilio/twilio-flex-token-validator) in the api's body call.
The signature JWT must be obtained from within Twilio Flex (recommended: look into the state via redux plugin for chrome).
To run locally:
1- `npm start`
2- Change your Flex plugin serverless endpoint or hit the route via CURL:
`curl -X GET '<twilio_serverless_api_endpoint_with_uri_params_if_any_and_valid_Token>'`
Explanation
"twilio_serverless_api_endpoint": the function endpoint (e.g. http://localhost:3000/yourFunction?)
"with_uri_params_if_any": append to the uri "param1=<value_1>&param2=<value_2>"
"and_valid_Token": finally append to the uri "Token=<valid_token>"

## tech-matters-serverless-helpers

This are helpers and functions reused across the various serverless functions.
They are packed as npm package because it's the easiest way to reuse the code within a Twilio Serverless Toolkit Project and preserve the typing information TS provides.

It's currenty deployed with Gian's npm account, [contact him](https://github.com/GPaoloni) to deploy new versions!

To deploy:
once inside the project folder (`cd tech-matters-serverless-helpers`)
1- `npm run build`
2- `npm publish` (must be logged in npm cli)
