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
import AWS, { LexRuntime, LexRuntimeV2 } from 'aws-sdk';

export type AWSCredentials = {
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
};

export type LexMemory = { [q: string]: string | number };

const postTextV1 = async (
  credentials: AWSCredentials,
  {
    botName,
    botAlias,
    inputText,
    userId,
  }: {
    botName: string;
    botAlias: string;
    inputText: string;
    userId: string;
  },
) => {
  const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, AWS_REGION } = credentials;
  try {
    AWS.config.update({
      credentials: {
        accessKeyId: ASELO_APP_ACCESS_KEY,
        secretAccessKey: ASELO_APP_SECRET_KEY,
      },
      region: AWS_REGION,
    });

    const Lex = new AWS.LexRuntime();

    const lexResponse = await Lex.postText({ botName, botAlias, inputText, userId }).promise();

    return { status: 'success', lexVersion: 'v1', lexResponse } as const;
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

const isEndOfDialogV1 = (dialogState: string | undefined) =>
  dialogState === 'Fulfilled' || dialogState === 'Failed';

const deleteSessionV1 = async (
  credentials: AWSCredentials,
  {
    botName,
    botAlias,
    userId,
  }: {
    botName: string;
    botAlias: string;
    userId: string;
  },
) => {
  try {
    AWS.config.update({
      credentials: {
        accessKeyId: credentials.ASELO_APP_ACCESS_KEY,
        secretAccessKey: credentials.ASELO_APP_SECRET_KEY,
      },
      region: credentials.AWS_REGION,
    });

    const Lex = new AWS.LexRuntime();

    const lexResponse = await Lex.deleteSession({
      botName,
      botAlias,
      userId,
    }).promise();

    return { status: 'success', lexVersion: 'v1', lexResponse } as const;
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

const getBotNameV1 = ({
  botLanguage,
  botSuffix,
  environment,
  helplineCode,
}: {
  environment: string;
  helplineCode: string;
  botLanguage: string;
  botSuffix: string;
}) => `${environment}_${helplineCode}_${botLanguage}_${botSuffix}`;

export const LexV1 = {
  postText: postTextV1,
  isEndOfDialog: isEndOfDialogV1,
  getBotName: getBotNameV1,
  deleteSession: deleteSessionV1,
};

export type LexV2Memory = {
  [q: string]: {
    originalValue: string | number;
    interpretedValue: string | number;
    resolvedValues: (string | number)[];
  };
};

const postTextV2 = async (
  credentials: AWSCredentials,
  {
    botAliasId,
    botId,
    localeId,
    sessionId,
    inputText,
  }: {
    botAliasId: string;
    botId: string;
    localeId: string;
    sessionId: string;
    inputText: string;
  },
) => {
  const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, AWS_REGION } = credentials;
  try {
    AWS.config.update({
      credentials: {
        accessKeyId: ASELO_APP_ACCESS_KEY,
        secretAccessKey: ASELO_APP_SECRET_KEY,
      },
      region: AWS_REGION,
    });

    const Lex = new AWS.LexRuntimeV2();

    const lexResponse = await Lex.recognizeText({
      botAliasId,
      botId,
      localeId,
      sessionId,
      text: inputText,
    }).promise();

    return { status: 'success', lexVersion: 'v2', lexResponse } as const;
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

export const isEndOfDialogV2 = (dialogState: string | undefined) => dialogState === 'Close';

export const deleteSessionV2 = async (
  credentials: AWSCredentials,
  {
    botAliasId,
    botId,
    localeId,
    sessionId,
  }: {
    botAliasId: string;
    botId: string;
    localeId: string;
    sessionId: string;
  },
) => {
  try {
    AWS.config.update({
      credentials: {
        accessKeyId: credentials.ASELO_APP_ACCESS_KEY,
        secretAccessKey: credentials.ASELO_APP_SECRET_KEY,
      },
      region: credentials.AWS_REGION,
    });

    const Lex = new AWS.LexRuntimeV2();

    const lexResponse = await Lex.deleteSession({
      botAliasId,
      botId,
      localeId,
      sessionId,
    }).promise();

    return { status: 'success', lexVersion: 'v2', lexResponse } as const;
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

const getBotNameV2 = async (
  credentials: AWSCredentials,
  {
    botLanguage,
    botSuffix,
    environment,
    helplineCode,
  }: {
    environment: string;
    helplineCode: string;
    botLanguage: string;
    botSuffix: string;
  },
) => {
  try {
    const { ASELO_APP_ACCESS_KEY, ASELO_APP_SECRET_KEY, AWS_REGION } = credentials;

    AWS.config.update({
      credentials: {
        accessKeyId: ASELO_APP_ACCESS_KEY,
        secretAccessKey: ASELO_APP_SECRET_KEY,
      },
      region: AWS_REGION,
    });

    const ssmParamName = `/${environment}/serverless/bots/${helplineCode}_${botLanguage}_${botSuffix}`;
    const SSM = new AWS.SSM();
    const botDetailsParam = await SSM.getParameter({
      Name: ssmParamName,
      WithDecryption: true,
    }).promise();
    if (!botDetailsParam.Parameter?.Value) {
      return {
        status: 'failure',
        error: new Error(`Invalid SSM parameter ${ssmParamName}`),
      } as const;
    }

    const { botAliasId, botId, localeId } = JSON.parse(botDetailsParam.Parameter?.Value);
    return {
      status: 'success',
      lexVersion: 'v2',
      botDetails: { botAliasId, botId, localeId },
    } as const;
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

const convertV2ToV1Memory = (memory: LexRuntimeV2.Slots | undefined): LexMemory => {
  if (!memory) {
    return {};
  }

  return Object.entries(memory).reduce(
    (accum, [q, { value }]) => ({ ...accum, [q]: value?.interpretedValue || '' }),
    {} as LexMemory,
  );
};

export const LexV2 = {
  postText: postTextV2,
  isEndOfDialog: isEndOfDialogV2,
  deleteSession: deleteSessionV2,
  getBotName: getBotNameV2,
  convertV2ToV1Memory,
};

export const postText = async (
  credentials: AWSCredentials,
  {
    botLanguage,
    botSuffix,
    enableLexV2,
    environment,
    helplineCode,
    inputText,
    userId,
  }: {
    enableLexV2: boolean;
    environment: string;
    helplineCode: string;
    botLanguage: string;
    botSuffix: string;
    inputText: string;
    userId: string;
  },
) => {
  try {
    if (enableLexV2) {
      const result = await LexV2.getBotName(credentials, {
        botLanguage,
        botSuffix,
        environment,
        helplineCode,
      });

      if (result.status === 'failure') {
        return result;
      }

      const { botAliasId, botId, localeId } = result.botDetails;

      return await LexV2.postText(credentials, {
        botAliasId,
        botId,
        inputText,
        localeId,
        sessionId: userId,
      });
    }

    const botName = LexV1.getBotName({ botLanguage, botSuffix, environment, helplineCode });
    const botAlias = 'latest'; // Assume we always use the latest published version

    return await LexV1.postText(credentials, { botAlias, botName, inputText, userId });
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

export const deleteSession = async (
  credentials: AWSCredentials,
  {
    botLanguage,
    botSuffix,
    enableLexV2,
    environment,
    helplineCode,
    userId,
  }: {
    enableLexV2: boolean;
    environment: string;
    helplineCode: string;
    botLanguage: string;
    botSuffix: string;
    userId: string;
  },
) => {
  try {
    if (enableLexV2) {
      const result = await LexV2.getBotName(credentials, {
        botLanguage,
        botSuffix,
        environment,
        helplineCode,
      });

      if (result.status === 'failure') {
        return result;
      }

      const { botAliasId, botId, localeId } = result.botDetails;

      return await LexV2.deleteSession(credentials, {
        botAliasId,
        botId,
        localeId,
        sessionId: userId,
      });
    }

    const botName = LexV1.getBotName({ botLanguage, botSuffix, environment, helplineCode });
    const botAlias = 'latest'; // Assume we always use the latest published version

    return await LexV1.deleteSession(credentials, { botAlias, botName, userId });
  } catch (error) {
    return {
      status: 'failure',
      error: error instanceof Error ? error : new Error(String(error)),
    } as const;
  }
};

export const isEndOfDialog = ({
  enableLexV2,
  lexResponse,
}:
  | {
      enableLexV2: false;
      lexResponse: LexRuntime.PostTextResponse;
    }
  | {
      enableLexV2: true;
      lexResponse: LexRuntimeV2.RecognizeTextResponse;
    }) => {
  if (enableLexV2) {
    return LexV2.isEndOfDialog(lexResponse.sessionState?.dialogAction?.type);
  }

  return LexV1.isEndOfDialog(lexResponse.dialogState);
};

export const getBotMemory = ({
  enableLexV2,
  lexResponse,
}:
  | {
      enableLexV2: false;
      lexResponse: LexRuntime.PostTextResponse;
    }
  | {
      enableLexV2: true;
      lexResponse: LexRuntimeV2.RecognizeTextResponse;
    }) => {
  if (enableLexV2) {
    return LexV2.convertV2ToV1Memory(lexResponse.sessionState?.intent?.slots);
  }

  return lexResponse.slots || {};
};

export type LexClient = {
  LexV1: typeof LexV1;
  LexV2: typeof LexV2;
  postText: typeof postText;
  deleteSession: typeof deleteSession;
  isEndOfDialog: typeof isEndOfDialog;
  getBotMemory: typeof getBotMemory;
};
