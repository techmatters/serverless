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

import * as fs from 'fs';

const TRANSLATIONS_DIR = './translations';
const ASSETS_DIR = './assets';

const bundleTranslations = () => {
  const languages = fs.readdirSync(TRANSLATIONS_DIR);

  const bundle = languages.reduce((acc, language) => {
    const files = fs.readdirSync(`${TRANSLATIONS_DIR}/${language}`);
    return {
      ...acc,
      [language]: files.reduce((filesAcc, file) => {
        const content = fs.readFileSync(`${TRANSLATIONS_DIR}/${language}/${file}`, 'utf-8');
        const key = file.replace('.json', '');
        return {
          ...filesAcc,
          [key]: JSON.parse(content),
        };
      }, {}),
    };
  }, {});

  fs.writeFileSync(`${ASSETS_DIR}/translations.private.json`, JSON.stringify(bundle, null, 2));

  console.log('Translations bundle was created successfully!');
};

bundleTranslations();
