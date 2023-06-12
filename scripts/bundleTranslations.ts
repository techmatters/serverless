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
