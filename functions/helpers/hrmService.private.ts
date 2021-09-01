import { get } from 'lodash';
// eslint-disable-next-line prettier/prettier
import type { BotMemory } from '../postSurveyComplete.protected';
import type { OneToManyConfigSpec, OneToManyConfigSpecs } from './insightsService.private';

export type PostSurveyData = { [question: string]: string | number };

const flattenOneToMany = (memory: BotMemory) => (previousValue: PostSurveyData, currentValue: OneToManyConfigSpec) => {
  const paths = currentValue.questions.map(
    question => ({ question, path: `twilio.collected_data.collect_survey.${question}.answer` }), // Path where the answer for each question should be in bot memory
  );

  const values: PostSurveyData = {};
  paths.forEach(p => {values[p.question] = get(memory, p.path, '');});

  return { ...previousValue, ...values };
};

export const buildDataObject = (oneToManyConfigSpecs: OneToManyConfigSpecs, memory: BotMemory) => {
  const reducerFunction = flattenOneToMany(memory);
  return oneToManyConfigSpecs.reduce<PostSurveyData>(reducerFunction, {});
};

export type BuildDataObject = typeof buildDataObject;
