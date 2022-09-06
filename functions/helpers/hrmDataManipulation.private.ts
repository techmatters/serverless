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
