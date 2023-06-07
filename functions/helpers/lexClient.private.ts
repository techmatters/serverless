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
import AWS from 'aws-sdk';

type AWSCredentials = {
  ASELO_APP_ACCESS_KEY: string;
  ASELO_APP_SECRET_KEY: string;
  AWS_REGION: string;
};

const postText = async (
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
  AWS.config.update({
    credentials: {
      accessKeyId: credentials.ASELO_APP_ACCESS_KEY,
      secretAccessKey: credentials.ASELO_APP_SECRET_KEY,
    },
    region: credentials.AWS_REGION,
  });

  const Lex = new AWS.LexRuntime();

  const lexResponse = await Lex.postText({ botName, botAlias, inputText, userId }).promise();

  return lexResponse;
};

const isEndOfDialog = (dialogState: string | undefined) =>
  dialogState === 'Fulfilled' || dialogState === 'Failed';

const deleteSession = (
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
  AWS.config.update({
    credentials: {
      accessKeyId: credentials.ASELO_APP_ACCESS_KEY,
      secretAccessKey: credentials.ASELO_APP_SECRET_KEY,
    },
    region: credentials.AWS_REGION,
  });

  const Lex = new AWS.LexRuntime();

  return Lex.deleteSession({
    botName,
    botAlias,
    userId,
  }).promise();
};

export default {
  postText,
  isEndOfDialog,
  deleteSession,
};

export type LexClient = {
  postText: typeof postText;
  isEndOfDialog: typeof isEndOfDialog;
  deleteSession: typeof deleteSession;
};
