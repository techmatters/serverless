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

import { capitalize } from 'lodash';

type MapperFunction = (options: string[]) => (value: string) => string;

type FormItemDefinition = {
  name: string;
  type: string;
  unknownOption: string;
  options: { value: string }[];
};

type PrepopulateKeys = {
  preEngagement: {
    ChildInformationTab: string[];
    CallerInformationTab: string[];
    CaseInformationTab: string[];
  };
  survey: { ChildInformationTab: string[]; CallerInformationTab: string[] };
};

type ChannelTypes =
  | 'voice'
  | 'sms'
  | 'facebook'
  | 'messenger'
  | 'whatsapp'
  | 'web'
  | 'telegram'
  | 'instagram'
  | 'line'
  | 'modica';

type HrmContactRawJson = {
  definitionVersion?: string;
  callType: string;
  childInformation: Record<string, boolean | string>;
  callerInformation: Record<string, boolean | string>;
  caseInformation: Record<string, boolean | string>;
  categories: Record<string, string[]>;
  contactlessTask: {
    channel: ChannelTypes;
    date: string;
    time: string;
    createdOnBehalfOf: `WK${string}` | '';
    [key: string]: string | boolean;
  };
};

export type HrmContact = {
  id: string;
  accountSid?: `AC${string}`;
  twilioWorkerId?: `WK${string}`;
  number: string;
  conversationDuration: number;
  csamReports: unknown[];
  referrals?: unknown[];
  conversationMedia?: unknown[];
  createdAt: string;
  createdBy: string;
  helpline: string;
  taskId: `WT${string}` | null;
  // taskReservationSid: string;
  profileId?: string;
  identifierId?: string;
  channel: ChannelTypes | 'default';
  updatedBy: string;
  updatedAt?: string;
  finalizedAt?: string;
  rawJson: HrmContactRawJson;
  timeOfContact: string;
  queueName: string;
  channelSid: string;
  serviceSid: string;
  caseId?: string;
};

const mapAge =
  (ageOptions: string[]) =>
  (age: string): string => {
    const ageInt = parseInt(age, 10);

    const maxAge = ageOptions.find((e) => e.includes('>'));

    if (maxAge) {
      const maxAgeInt = parseInt(maxAge.replace('>', ''), 10);

      if (ageInt >= 0 && ageInt <= maxAgeInt) {
        return ageOptions.find((o) => parseInt(o, 10) === ageInt) || 'Unknown';
      }

      if (ageInt > maxAgeInt) return maxAge;
    } else {
      console.error('Pre populate form error: no maxAge option provided.');
    }

    return 'Unknown';
  };

const mapGenericOption = (options: string[]) => (value: string) => {
  const validOption = options.find((e) => e.toLowerCase() === value.toLowerCase());

  if (!validOption) {
    return 'Unknown';
  }

  return validOption;
};

const getUnknownOption = (key: string, definition: FormItemDefinition[]) => {
  const inputDef = definition.find((e) => e.name === key);

  if (inputDef && inputDef.type === 'select') {
    const unknownOption = inputDef.unknownOption
      ? inputDef.options.find((e) => e.value === inputDef.unknownOption)
      : inputDef.options.find((e) => e.value === 'Unknown');
    if (unknownOption && unknownOption.value) return unknownOption.value;

    console.error(`getUnknownOption couldn't determine a valid unknown option for key ${key}.`);
  }

  return 'Unknown';
};

/**
 * Given a key and a form definition, grabs the input with name that equals the key and return the options values, or empty array.
 */
const getSelectOptions = (key: string) => (definition: FormItemDefinition[]) => {
  const inputDef = definition.find((e) => e.name === key);

  if (inputDef?.type === 'select') return inputDef.options.map((e) => e.value) || [];

  console.error(`getSelectOptions called with key ${key} but is a non-select input type.`);
  return [];
};

const getAnswerOrUnknown = (
  answers: any,
  key: string,
  definition: FormItemDefinition[],
  mapperFunction: MapperFunction = mapGenericOption,
) => {
  // This keys must be set with 'Unknown' value even if there's no answer
  const isRequiredKey = key === 'age' || key === 'gender';

  // This prevents setting redux state with the 'Unknown' value for a property that is not asked by the pre-survey
  if (!isRequiredKey && !answers[key]) return null;

  const itemDefinition = definition.find((e) => e.name === key);

  // This prevents setting redux state with the 'Unknown' value for a property that is not present on the definition
  if (!itemDefinition) {
    console.error(`${key} does not exist in the current definition`);
    return null;
  }

  if (itemDefinition.type === 'select') {
    const unknown = getUnknownOption(key, definition);
    const isUnknownAnswer = !answers[key] || answers[key] === unknown;

    if (isUnknownAnswer) return unknown;

    const options = getSelectOptions(key)(definition);
    const result = mapperFunction(options)(answers[key]);

    return result === 'Unknown' ? unknown : result;
  }

  return answers[key];
};

const getValuesFromAnswers = (
  prepopulateKeys: string[],
  tabFormDefinition: FormItemDefinition[],
  answers: any,
): Record<string, string> => {
  // Get values from task attributes
  const { firstName, language } = answers;

  // Get required values from bot's memory
  const age = getAnswerOrUnknown(answers, 'age', tabFormDefinition, mapAge);
  const gender = getAnswerOrUnknown(answers, 'gender', tabFormDefinition);

  // This field is not required yet it's bundled here as if it were. Leaving it from now but should we move it to prepopulateKeys where it's used?
  const ethnicity = getAnswerOrUnknown(answers, 'ethnicity', tabFormDefinition);

  // Get the customizable values from the bot's memory if there's any value (defined in PrepopulateKeys.json)
  const customizableValues = prepopulateKeys.reduce((accum, key) => {
    const value = getAnswerOrUnknown(answers, key, tabFormDefinition);
    return value ? { ...accum, [key]: value } : accum;
  }, {});

  return {
    ...(firstName && { firstName }),
    ...(gender && { gender }),
    ...(age && { age }),
    ...(ethnicity && { ethnicity }),
    ...(language && { language: capitalize(language) }),
    ...customizableValues,
  };
};

const loadedConfigJsons: Record<string, any> = {};

const loadConfigJson = async (formDefinitionRootUrl: URL, section: string): Promise<any> => {
  if (!loadedConfigJsons[section]) {
    const url = `${formDefinitionRootUrl}/${section}.json`;
    const response = await fetch(url);
    loadedConfigJsons[section] = response.json();
  }
  return loadedConfigJsons[section];
};

export const getValuesFromPreEngagementData = (
  prepopulateKeys: string[],
  tabFormDefinition: FormItemDefinition[],
  preEngagementData: Record<string, string>,
) => {
  // Get values from task attributes
  const values: Record<string, string | boolean> = {};
  tabFormDefinition.forEach((field: FormItemDefinition) => {
    if (prepopulateKeys.indexOf(field.name) > -1) {
      if (['mixed-checkbox', 'checkbox'].includes(field.type)) {
        const fieldValue = preEngagementData[field.name]?.toLowerCase();
        if (fieldValue === 'yes') {
          values[field.name] = true;
        } else if (fieldValue === 'no' || field.type === 'checkbox') {
          values[field.name] = false;
        }
        return;
      }
      values[field.name] = preEngagementData[field.name] || '';
    }
  });
  return values;
};

const populateContactSection = async (
  contact: HrmContact,
  valuesToPopulate: Record<string, string>,
  keys: string[],
  formDefinitionRootUrl: URL,
  tabbedFormsSection: 'CaseInformationTab' | 'ChildInformationTab' | 'CallerInformationTab',
  converter: (
    keys: string[],
    formTabDefinition: FormItemDefinition[],
    values: Record<string, string>,
  ) => Record<string, string | boolean>,
) => {
  if (keys.length > 0) {
    const childInformationTabDefinition = await loadConfigJson(
      formDefinitionRootUrl,
      `tabbedForms/${tabbedFormsSection}`,
    );
    Object.assign(
      contact.rawJson.childInformation,
      converter(keys, childInformationTabDefinition, valuesToPopulate),
    );
  }
};

export const prepopulateForm = async (
  taskAttributes: Record<string, any>,
  contact: HrmContact,
  formDefinitionRootUrl: URL,
): Promise<HrmContact> => {
  const { memory, preEngagementData, firstName, language } = taskAttributes;
  const answers = { ...memory, firstName, language };

  if (!answers && !preEngagementData) return contact;
  const { preEngagement: preEngagementKeys, survey: surveyKeys }: PrepopulateKeys =
    await loadConfigJson(formDefinitionRootUrl, 'PrepopulateKeys');

  const isValidSurvey = Boolean(answers?.aboutSelf); // determines if the memory has valid values or if it was aborted
  const isAboutSelf = !answers || answers.aboutSelf === 'Yes';

  if (preEngagementData) {
    await populateContactSection(
      contact,
      preEngagementData,
      preEngagementKeys.CaseInformationTab,
      formDefinitionRootUrl,
      'CaseInformationTab',
      getValuesFromPreEngagementData,
    );

    if (!isValidSurvey || isAboutSelf) {
      await populateContactSection(
        contact,
        preEngagementData,
        preEngagementKeys.ChildInformationTab,
        formDefinitionRootUrl,
        'ChildInformationTab',
        getValuesFromPreEngagementData,
      );
    } else {
      await populateContactSection(
        contact,
        preEngagementData,
        preEngagementKeys.CallerInformationTab,
        formDefinitionRootUrl,
        'CallerInformationTab',
        getValuesFromPreEngagementData,
      );
    }
  }

  if (answers && isValidSurvey) {
    if (isAboutSelf) {
      await populateContactSection(
        contact,
        answers,
        surveyKeys.ChildInformationTab,
        formDefinitionRootUrl,
        'ChildInformationTab',
        getValuesFromAnswers,
      );
    } else {
      await populateContactSection(
        contact,
        answers,
        surveyKeys.CallerInformationTab,
        formDefinitionRootUrl,
        'CallerInformationTab',
        getValuesFromAnswers,
      );
    }
  }
  return contact;
};

export type PrepopulateForm = typeof prepopulateForm;
