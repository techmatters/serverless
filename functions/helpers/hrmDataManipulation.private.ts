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

import { get } from 'lodash';
// eslint-disable-next-line prettier/prettier
import type { BotMemory } from '../postSurveyComplete.protected';
import type { OneToManyConfigSpec } from './insightsService.private';

export type PostSurveyData = { [question: string]: string | number };

/**
 * Given a bot's memory returns a function to reduce over an array of OneToManyConfigSpec.
 * The function returned will grab all the answers to the questions defined in the OneToManyConfigSpecs
 * and return a flattened object of type PostSurveyData
 */
const flattenOneToMany =
  (memory: BotMemory) => (accum: PostSurveyData, curr: OneToManyConfigSpec) => {
    const paths = curr.questions.map(
      (question) => ({
        question,
        path: `twilio.collected_data.collect_survey.answers.${question}.answer`,
      }), // Path where the answer for each question should be in bot memory
    );

    const values: PostSurveyData = {};
    paths.forEach((p) => {
      values[p.question] = get(memory, p.path, '');
    });

    return { ...accum, ...values };
  };

/**
 * Given the config for the post survey and the bot's memory, returns the collected answers in the fomat it's stored in HRM.
 */
export const buildDataObject = (oneToManyConfigSpecs: OneToManyConfigSpec[], memory: BotMemory) => {
  const reducerFunction = flattenOneToMany(memory);
  return oneToManyConfigSpecs.reduce<PostSurveyData>(reducerFunction, {});
};

export type BuildDataObject = typeof buildDataObject;
