/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import '@twilio-labs/serverless-runtime-types';
import { Context, ServerlessCallback } from '@twilio-labs/serverless-runtime-types/types';
import {
  responseWithCors,
  bindResolve,
  error400,
  error500,
  success,
  functionValidator as TokenValidator,
} from '@tech-matters/serverless-helpers';
import type { TaskInstance } from 'twilio/lib/rest/taskrouter/v1/workspace/task';
import { ChatChannelJanitor } from './helpers/chatChannelJanitor.private';

type EnvVars = {
  CHAT_SERVICE_SID: string;
  TWILIO_WORKSPACE_SID: string;
  FLEX_PROXY_SERVICE_SID: string;
};

export type Body = {
  channelSid?: string;
  language?: string;
  request: { cookies: {}; headers: {} };
};

type Messages = {
  EndChatMsg: string;
};

const getEndChatMessage = (event: Body): string => {
  // Retrieve the EndChatMsg for appropriate language
  const { language } = event;

  if (language) {
    try {
      const translation: Messages = JSON.parse(
        Runtime.getAssets()[`/translations/${language}/messages.json`].open(),
      );
      const { EndChatMsg } = translation;
      if (EndChatMsg) return EndChatMsg;
    } catch {
      console.error(`Couldn't retrieve EndChatMsg message translation for ${language}`);
    }
  }
  return 'User left the conversation';
};

export const handler = TokenValidator(
  async (context: Context<EnvVars>, event: Body, callback: ServerlessCallback) => {
    const response = responseWithCors();
    const resolve = bindResolve(callback)(response);
    console.log(' ------ endChat execution starts -----');

    try {
      const client = context.getTwilioClient();

      const { channelSid, language } = event;

      if (channelSid === undefined) {
        resolve(error400('ChannelSid parameter is missing'));
        return;
      }
      if (language === undefined) {
        resolve(error400('language parameter is missing'));
        return;
      }

      let channelCleanupRequired = false;

      // Use the channelSid to fetch task that needs to be closed
      const channel = await client.chat
        .services(context.CHAT_SERVICE_SID)
        .channels(channelSid)
        .fetch();
      const channelAttributes = JSON.parse(channel.attributes);

      if (channelAttributes.taskSid) {
        // Fetch the Task to 'cancel' or 'wrapup'
        const task = await client.taskrouter
          .workspaces(context.TWILIO_WORKSPACE_SID)
          .tasks(channelAttributes.taskSid)
          .fetch();

        // Send a Message indicating user left the conversation
        if (task.assignmentStatus === 'assigned') {
          const endChatMessage = getEndChatMessage(event);
          await context
            .getTwilioClient()
            .chat.services(context.CHAT_SERVICE_SID)
            .channels(channelSid)
            .messages.create({
              body: endChatMessage,
              from: 'Bot',
              xTwilioWebhookEnabled: 'true',
            });
        }

        // Update the task assignmentStatus
        const updateAssignmentStatus = (assignmentStatus: TaskInstance['assignmentStatus']) =>
          client.taskrouter
            .workspaces(context.TWILIO_WORKSPACE_SID)
            .tasks(channelAttributes.taskSid)
            .update({ assignmentStatus });

        switch (task.assignmentStatus) {
          case 'reserved':
          case 'pending': {
            await updateAssignmentStatus('canceled');
            channelCleanupRequired = true;
            break;
          }
          case 'assigned': {
            await updateAssignmentStatus('wrapping');
            break;
          }
          default:
        }
      }

      /** ==================== */
      /* TODO: Once all accounts are ready to manage triggering post survey on task wrap within taskRouterCallback, the following clean up can be removed */
      const serviceConfig = await client.flexApi.configuration.get().fetch();
      const { feature_flags: featureFlags } = serviceConfig.attributes;
      if (channelCleanupRequired || !featureFlags.post_survey_serverless_handled) {
        // Deactivate channel and proxy
        const handlerPath = Runtime.getFunctions()['helpers/chatChannelJanitor'].path;
        const chatChannelJanitor = require(handlerPath).chatChannelJanitor as ChatChannelJanitor;
        await chatChannelJanitor(context, { channelSid });
      }
      /** ==================== */

      resolve(success(JSON.stringify({ message: 'End Chat OK!' })));
      return;
    } catch (err: any) {
      resolve(error500(err));
    }
  },
  { allowGuestToken: true },
);
