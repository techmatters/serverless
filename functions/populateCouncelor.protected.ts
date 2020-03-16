import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';
import fetch from 'node-fetch';

type Worker = {
  sid: string;
  friendly_name: string;
};

type ExpectedResponse = {
  workers: Worker[];
};

type EventBody = {
  workspaceSID: string | null;
};

const credentials = Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString(
  'base64',
);

const fetchData = async (workspaceSID: string): Promise<ExpectedResponse> => {
  const data = await fetch(`https://taskrouter.twilio.com/v1/Workspaces/${workspaceSID}/Workers`, {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
    },
  });

  const dataJson = await data.json();

  return dataJson;
};

export const handler: ServerlessFunctionSignature = async (
  context: Context,
  event: {},
  callback: ServerlessCallback,
) => {
  try {
    const body = event as EventBody;
    // TODO: remove the env default as this is to simplify testing
    const workspaceSID = body.workspaceSID || process.env.TORONTO_LINE_WORKSPACE;

    if (workspaceSID === undefined) {
      callback('Error: Workspace parameter not provided');
      return;
    }

    const dataJson = await fetchData(workspaceSID);

    if (dataJson.workers === undefined) {
      callback('Error: Workspace not found');
      return;
    }

    const workers = dataJson.workers.map((w: Worker) => ({
      sid: w.sid,
      friendly_name: w.friendly_name,
    }));

    callback(null, workers);
  } catch (err) {
    callback(err);
  }
};
