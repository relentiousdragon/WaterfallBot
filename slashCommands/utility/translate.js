const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const { LANGUAGES, getLanguageName, discordLocaleToLang, translateText } = require("../../util/translateHelper.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('translate')
        .setNameLocalizations(commandMeta.translate.name)
        .setDescription('Translate text between languages')
        .setDescriptionLocalizations(commandMeta.translate.description)
        .addStringOption(opt =>
            opt.setName('text')
                .setNameLocalizations(commandMeta.translate.option_text_name || {})
                .setDescription('Text to translate')
                .setDescriptionLocalizations(commandMeta.translate.option_text_description || {})
                .setRequired(true)
                .setMaxLength(500)
        )
        .addStringOption(opt =>
            opt.setName('target')
                .setNameLocalizations(commandMeta.translate.option_target_name || {})
                .setDescription('Target language (defaults to your Discord language)')
                .setDescriptionLocalizations(commandMeta.translate.option_target_description || {})
                .setAutocomplete(true)
        )
        .addStringOption(opt =>
            opt.setName('source')
                .setNameLocalizations(commandMeta.translate.option_source_name || {})
                .setDescription('Source language (defaults to auto-detect)')
                .setDescriptionLocalizations(commandMeta.translate.option_source_description || {})
                .setAutocomplete(true)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async autocomplete(interaction, bot, settings) {
        const focused = interaction.options.getFocused().toLowerCase();
        const filtered = LANGUAGES
            .filter(l => l.name.toLowerCase().includes(focused) || l.value.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(l => ({ name: `${l.name} (${l.value})`, value: l.value }));
        await interaction.respond(filtered);
    },
    async execute(bot, interaction, funcs, settings, logger, t) {
        const text = interaction.options.getString('text');
        const targetLang = interaction.options.getString('target') || discordLocaleToLang(interaction.locale);
        const sourceLang = interaction.options.getString('source') || 'auto';

        const sourceName = getLanguageName(sourceLang === 'auto' ? 'auto' : sourceLang);
        const targetName = getLanguageName(targetLang);

        const loadingContainer = new ContainerBuilder()
            .setAccentColor(0x3b82f6)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://images.icon-icons.com/1011/PNG/512/Google_Translate_icon-icons.com_75723.png'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.language} ${t('commands:translate.translating')}\n-# ${e.loading} ${t('common:loading')}`)
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall \u2022 ${sourceName} - ${targetName}`)
            );
        await interaction.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

        try {
            const { translated, detectedSource, quality, reference } = await translateText(text, sourceLang === 'auto' ? null : sourceLang, targetLang);

            const detectedSourceName = getLanguageName(detectedSource === 'auto' ? 'auto' : detectedSource);
            const isSameLanguage = translated.toLowerCase() === text.toLowerCase();

            let footerNote = '';
            if (isSameLanguage) {
                footerNote = `\n-# ${t('commands:translate.same_language')}`;
            }

            const resultContainer = new ContainerBuilder()
                .setAccentColor(0x3b82f6)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://images.icon-icons.com/1011/PNG/512/Google_Translate_icon-icons.com_75723.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.language} ${t('commands:translate.result_title')}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${detectedSourceName}** \u2192 **${targetName}**`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${t('commands:translate.original')}:**\n${funcs.truncate(text, 1000)}`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${t('commands:translate.translated')}:**\n${funcs.truncate(translated, 1000)}`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Waterfall \u2022 ${detectedSourceName} - ${targetName}${quality != null ? ` \u2022 ${quality}%` : ''}${reference ? ` \u2022 ${reference}` : ''}${footerNote}`)
                );

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });

        } catch (err) {
            logger.error(`[Translate] Error:`, err.message || err);

            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xFF0000)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://images.icon-icons.com/1011/PNG/512/Google_Translate_icon-icons.com_75723.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('common:error_occurred')}`),
                            new TextDisplayBuilder().setContent(t('commands:translate.error_generic'))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Waterfall \u2022 ${sourceName} - ${targetName}`)
                );
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });

            const isDev = settings?.devs?.includes(interaction.user.id);
            if (isDev) {
                const parts = [];
                if (err.message) parts.push(err.message);
                if (err.errors) parts.push(JSON.stringify(err.errors, null, 2).slice(0, 500));
                if (err.rawError?.errors) parts.push(JSON.stringify(err.rawError.errors, null, 2).slice(0, 500));
                if (err.rawError?.message && err.rawError.message !== err.message) parts.push(err.rawError.message);
                if (err.response?.data) parts.push(JSON.stringify(err.response.data).slice(0, 500));
                const errorInfo = parts.join('\n').replace(/```/g, '\u200B```').slice(0, 1900);
                await interaction.followUp({
                    content: '```\n' + errorInfo + '\n```',
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
    help: {
        name: "translate",
        description: "Translate text between languages",
        category: "Utility",
        permissions: [],
        botPermissions: [],
        created: Date.now()
    }
};

// contributors: @relentiousdragon
