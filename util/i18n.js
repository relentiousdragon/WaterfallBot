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
            ns: ['common', 'commands', 'events', 'modlog'],
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
    let enCommands = {};
    if (fs.existsSync(enCommandsPath)) {
        try {
            enCommands = JSON.parse(fs.readFileSync(enCommandsPath, 'utf8'));
        } catch (err) {
            logger.error(`[Localization] Error loading English commands.json:`, err);
        }
        for (const cmdName of Object.keys(enCommands)) {
            metadata[cmdName] = {
                name: { 'en-US': enCommands[cmdName].name || null },
                description: { 'en-US': enCommands[cmdName].description || null }
            };
            for (const key of Object.keys(enCommands[cmdName])) {
                if (key !== 'name' && key !== 'description') {
                    metadata[cmdName][key] = { 'en-US': enCommands[cmdName][key] || null };
                }
            }
        }
    }

    const discordLocaleMap = {
        'es': 'es-ES',
        'pt': 'pt-BR',
        'sv': 'sv-SE',
        'zh': 'zh-CN',
        'en': 'en-US'
    };

    for (const lang of languages) {
        const commandsPath = path.join(localesDir, lang, 'commands.json');
        const discordLocale = discordLocaleMap[lang] || lang;
        let langCommands = {};
        if (fs.existsSync(commandsPath)) {
            try {
                langCommands = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
            } catch (err) {
                logger.error(`[Localization] Error loading commands.json for ${lang}:`, err);
            }
        }
        for (const cmdKey of Object.keys(metadata)) {
            const enMeta = enCommands[cmdKey] || {};
            const langMeta = langCommands[cmdKey] || {};
            metadata[cmdKey].name[discordLocale] = langMeta.name || enMeta.name || metadata[cmdKey].name['en-US'] || null;
            metadata[cmdKey].description[discordLocale] = langMeta.description || enMeta.description || metadata[cmdKey].description['en-US'] || null;
            for (const key of Object.keys(enMeta)) {
                if (key === 'name' || key === 'description') continue;
                if (!metadata[cmdKey][key]) metadata[cmdKey][key] = {};
                metadata[cmdKey][key][discordLocale] = langMeta[key] || enMeta[key] || metadata[cmdKey][key]['en-US'] || null;
            }
        }
    }

    for (const [cmdKey, cmdData] of Object.entries(metadata)) {
        const enMeta = enCommands[cmdKey] || {};
        if (!cmdData.name['en-US'] && enMeta.name) {
            metadata[cmdKey].name['en-US'] = enMeta.name;
        }
        if (!cmdData.description['en-US'] && enMeta.description) {
            metadata[cmdKey].description['en-US'] = enMeta.description;
        }
        for (const key of Object.keys(enMeta)) {
            if (key === 'name' || key === 'description') continue;
            if (!metadata[cmdKey][key]) metadata[cmdKey][key] = {};
            if (!metadata[cmdKey][key]['en-US'] && enMeta[key]) {
                metadata[cmdKey][key]['en-US'] = enMeta[key];
            }
        }
    }

    return metadata;
}

async function reloadI18n() {
    i18n.services.resourceStore.data = {};

    await i18n.reloadResources();
    await i18n.loadLanguages(i18n.languages);
    logger.gradient('i18n resources reloaded');
}
//
module.exports = {
    i18n,
    initI18n,
    getCommandMetadata,
    reloadI18n
};
