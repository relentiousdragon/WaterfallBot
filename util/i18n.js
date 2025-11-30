const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const fs = require('fs');
const logger = require("../logger.js");

const i18n = i18next.createInstance();

async function initI18n() {
    await i18n
        .use(Backend)
        .init({
            lng: 'en',
            fallbackLng: 'en',
            preload: ['en'],
            ns: ['common', 'commands', 'events'],
            defaultNS: 'common',
            backend: {
                loadPath: path.join(__dirname, '../locales/{{lng}}/{{ns}}.json'),
            },
            interpolation: {
                escapeValue: false,
            },
        });

    logger.gradient('i18n initialized');
}

function getCommandMetadata() {
    const localesDir = path.join(__dirname, '..', 'locales');
    const metadata = {};

    const languages = fs.readdirSync(localesDir).filter(file => {
        return fs.statSync(path.join(localesDir, file)).isDirectory() && file !== 'en';
    });

    const enCommandsPath = path.join(localesDir, 'en', 'commands.json');
    if (fs.existsSync(enCommandsPath)) {
        const enCommands = require(enCommandsPath);
        for (const cmdName of Object.keys(enCommands)) {
            metadata[cmdName] = {
                name: {},
                description: {}
            };
        }
    }

    for (const lang of languages) {
        const commandsPath = path.join(localesDir, lang, 'commands.json');

        if (fs.existsSync(commandsPath)) {
            try {
                const commands = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));

                for (const [cmdKey, cmdData] of Object.entries(commands)) {
                    if (metadata[cmdKey]) {
                        if (cmdData.name) {
                            metadata[cmdKey].name[lang] = cmdData.name;
                        }
                        if (cmdData.description) {
                            metadata[cmdKey].description[lang] = cmdData.description;
                        }
                    }
                }
            } catch (err) {
                logger.error(`[Localization] Error loading commands.json for ${lang}:`, err);
            }
        }
    }

    return metadata;
}

module.exports = {
    i18n,
    initI18n,
    getCommandMetadata: getCommandMetadata()
};
