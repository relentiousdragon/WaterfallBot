const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const axios = require('axios');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const funcs = require("../../util/functions.js");

async function getMeme() {
    try {
        const response = await axios.get('https://meme-api.com/gimme');
        return response.data;
    } catch (error) {
        return null;
    }
}

function buildMemeContainer(meme, t, interaction) {
    if (!meme) {
        return new ContainerBuilder()
            .setAccentColor(0xE74C3C)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# ${e.pixel_warning} ${t('commands:meme.failed_fetch')}`),
                new TextDisplayBuilder().setContent(t('commands:meme.try_again'))
            );
    }

    return new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:meme.title')}`),
            new TextDisplayBuilder().setContent(`## ${meme.title}`)
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(meme.url)
                    .setDescription(meme.title)
            )
        );
}

function buildRefreshButton(userId, t) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`meme_refresh_${userId}`)
            .setLabel(t('commands:meme.refresh'))
            .setStyle(ButtonStyle.Primary)
            .setEmoji(funcs.parseEmoji(e.reload2))
    );
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('meme')
        .setNameLocalizations(commandMeta.meme?.name || {})
        .setDescription('Get a random meme')
        .setDescriptionLocalizations(commandMeta.meme?.description || {}),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply();

            const meme = await getMeme();
            const container = buildMemeContainer(meme, t, interaction);
            const row = buildRefreshButton(interaction.user.id, t);

            await interaction.editReply({
                components: [container, row],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            logger.error("[/MEME] Error executing command:", error);
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xff0000)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('common:error')}`)
                );
            return interaction.editReply({
                components: [errorContainer],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });
        }
    },
    async handleButton(bot, interaction, t, logger) {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const ownerId = parts[2];

        if (action !== 'refresh') return;

        if (interaction.user.id !== ownerId) {
            return interaction.reply({
                content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.deferUpdate();

            const meme = await getMeme();
            const container = buildMemeContainer(meme, t, interaction);
            const row = buildRefreshButton(ownerId, t);

            await interaction.editReply({
                components: [container, row],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            logger.error("[/MEME] Error handling button:", error);
            return interaction.reply({
                content: `${e.pixel_cross} ${t('common:error')}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "meme",
        description: "Generate a random meme",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1766228122
    }
};
