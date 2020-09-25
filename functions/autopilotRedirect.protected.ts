import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from '@twilio-labs/serverless-runtime-types/types';

export interface Event {
  Memory: string;
  Channel: string;
  UserIdentifier: string;
}

type EnvVars = {
  TWILIO_CHAT_TRANSFER_WORKFLOW_SID: string;
};

const handleChatChannel = async (context: Context<EnvVars>, event: Event) => {
  const memory = JSON.parse(event.Memory);
  const { ServiceSid, ChannelSid } = memory.twilio.chat;

  const channel = await context
    .getTwilioClient()
    .chat.services(ServiceSid)
    .channels(ChannelSid)
    .fetch();

  const attributes = JSON.parse(channel.attributes);

  // if channel is webchat, disable the input
  if (attributes.channel_type === 'web') {
    const user = await context
      .getTwilioClient()
      .chat.services(ServiceSid)
      .users(event.UserIdentifier)
      .fetch();

    const userAttr = JSON.parse(user.attributes);
    const updatedAttr = { ...userAttr, lockInput: true };

    await user.update({ attributes: JSON.stringify(updatedAttr) });
  }
};

const buildActionsArray = (context: Context<EnvVars>, event: Event) => {
  const memory = JSON.parse(event.Memory);

  switch (memory.at) {
    case 'survey': {
      if (event.Channel === 'voice') {
        const say = { say: 'Hold on, we are connecting you with an agent' };
        const handoff = {
          handoff: {
            channel: 'voice',
            uri: `taskrouter://${context.TWILIO_CHAT_TRANSFER_WORKFLOW_SID}`,
          },
        };
        return [say, handoff];
      }

      const redirect = { redirect: 'task://counselor_handoff' };
      return [redirect];
    }
    case 'gender_why': {
      const { gender } = memory.twilio.collected_data.collect_survey.answers;

      // Handle someone asking "why" or questioning what is meant by gender
      // Answers to the "why" question will never produce this
      if (gender.error === undefined && gender.answer.toLowerCase() === 'why') {
        const redirect = { redirect: 'task://gender_why' };
        return [redirect];
      }

      const redirect = { redirect: 'task://counselor_handoff' };
      return [redirect];
    }
    default: {
      // If we ever get here, it's in error
      // Just handoff to counselor for now, maybe need to internally record an error
      const redirect = { redirect: 'task://counselor_handoff' };
      return [redirect];
    }
  }
};

export const handler: ServerlessFunctionSignature<EnvVars, Event> = async (
  context: Context<EnvVars>,
  event: Event,
  callback: ServerlessCallback,
) => {
  if (event.Channel === 'chat') await handleChatChannel(context, event);
  const actions = buildActionsArray(context, event);
  const returnObj = { actions };

  callback(null, returnObj);
};
