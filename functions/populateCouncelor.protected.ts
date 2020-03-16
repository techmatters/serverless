import '@twilio-labs/serverless-runtime-types';
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

type EventBody = {
  workspaceSID: string | null;
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

    const workspace = await context
      .getTwilioClient()
      .taskrouter.workspaces(workspaceSID)
      .fetch();

    const workers = await workspace.workers().list();

    const prettyWorkers = workers.map(w => ({
      sid: w.sid,
      friendlyName: w.friendlyName,
    }));

    callback(null, prettyWorkers);
  } catch (err) {
    callback(err);
  }
};
