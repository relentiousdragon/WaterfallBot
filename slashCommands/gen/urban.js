const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('urban')
        .setNameLocalizations(commandMeta.urban.name)
        .setDescription('Look up a word on Urban Dictionary')
        .setDescriptionLocalizations(commandMeta.urban.description)
        .addStringOption(opt =>
            opt.setName('word')
                .setNameLocalizations(commandMeta.urban.option_word_name || {})
                .setDescription('The word or phrase to look up')
                .setDescriptionLocalizations(commandMeta.urban.option_word_description || {})
                .setRequired(true)
                .setMaxLength(200)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const word = interaction.options.getString('word');

        const loadingContainer = new ContainerBuilder()
            .setAccentColor(0x1D1D1D)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://seeklogo.com/images/U/urban-dictionary-logo-603763A707-seeklogo.com.png'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.bookmark} ${t('commands:urban.looking_up')}\n-# ${e.loading} ${t('common:loading')}`)
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent("-# Waterfall")
            );
        await interaction.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

        try {
            const response = await axios.get(`https://api.urbandictionary.com/v0/define`, {
                params: { term: word },
                timeout: 10000
            });

            const entries = response.data?.list;
            if (!entries || entries.length === 0) {
                const errorContainer = new ContainerBuilder()
                    .setAccentColor(0xFF0000)
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://seeklogo.com/images/U/urban-dictionary-logo-603763A707-seeklogo.com.png'))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('commands:urban.not_found')}`),
                                new TextDisplayBuilder().setContent(t('commands:urban.not_found_desc', { word }))
                            )
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    ).addTextDisplayComponents(
                        new TextDisplayBuilder().setContent("-# Waterfall - Urban Dictionary")
                    );
                return interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const entry = entries[0];
            let definition = entry.definition || 'No definition provided.';
            if (definition.length > 900) {
                definition = definition.slice(0, 897) + '...';
            }

            let example = entry.example || '';
            if (example.length > 400) {
                example = example.slice(0, 397) + '...';
            }

            let content = `**Definition:**\n${definition}`;
            if (example) {
                content += `\n\n**Example:**\n> _${example}_`;
            }

            const resultContainer = new ContainerBuilder()
                .setAccentColor(0x1D1D1D)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://seeklogo.com/images/U/urban-dictionary-logo-603763A707-seeklogo.com.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.bookmark} ${entry.word}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(content)
                );

            if (entries.length > 1) {
                const moreEntries = entries.slice(1, 4);
                let moreText = `**${t('commands:urban.more_entries')}:**\n`;
                moreEntries.forEach((e, i) => {
                    let def = e.definition || '';
                    if (def.length > 200) def = def.slice(0, 197) + '...';
                    moreText += `\n**${i + 2}.** *${e.word}* - ${def}\n`;
                });
                resultContainer.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(moreText)
                );
            }

            if (entry.permalink) {
                const linkButton = new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel(t('commands:urban.view_on_ud'))
                    .setURL(entry.permalink);
                const row = new ActionRowBuilder().addComponents(linkButton);
                resultContainer.addActionRowComponents(row);
            }

            resultContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Urban Dictionary`)
            );

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });

        } catch (err) {
            if (settings.debug == "true") { logger.error(err); }
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xFF0000)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://seeklogo.com/images/U/urban-dictionary-logo-603763A707-seeklogo.com.png'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('common:error_occurred')}`),
                            new TextDisplayBuilder().setContent(t('commands:urban.error_generic'))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("-# Waterfall - Urban Dictionary")
                );
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
    help: {
        name: "urban",
        description: "Look up a word on Urban Dictionary",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: Date.now()
    }
};

// contributors: @relentiousdragon
