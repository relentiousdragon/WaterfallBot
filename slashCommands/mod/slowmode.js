const { SlashCommandBuilder, MessageFlags, ChannelType, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionsBitField } = require('discord.js');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setNameLocalizations(commandMeta.slowmode.name)
        .setDescription('Set the slowmode delay for a channel')
        .setDescriptionLocalizations(commandMeta.slowmode.description)
        .addIntegerOption(opt =>
            opt.setName('duration')
                .setNameLocalizations(commandMeta.slowmode.option_duration_name || {})
                .setDescription('Slowmode delay in seconds (0 to disable, max 21600)')
                .setDescriptionLocalizations(commandMeta.slowmode.option_duration_description || {})
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600)
        )
        .addChannelOption(opt =>
            opt.setName('channel')
                .setNameLocalizations(commandMeta.slowmode.option_channel_name || {})
                .setDescription('Channel to set slowmode on (defaults to current channel)')
                .setDescriptionLocalizations(commandMeta.slowmode.option_channel_description || {})
                .addChannelTypes(ChannelType.GuildText)
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:slowmode.error_permission')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const duration = interaction.options.getInteger('duration');

        const durationFormatted = duration === 0
            ? t('commands:slowmode.disabled')
            : funcs.formatDurationPretty(duration * 1000, { maxUnit: 'h' });

        const loadingContainer = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn.discordapp.com/emojis/1444028041771880659.webp'))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.channel} ${t('commands:slowmode.setting')}\n-# ${e.loading} ${t('common:loading')}`)
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent("-# Waterfall")
            );
        await interaction.reply({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

        try {
            await channel.setRateLimitPerUser(duration, `Slowmode changed by ${interaction.user.tag}`);

            const color = duration === 0 ? 0x10B981 : 0xF59E0B;
            const statusEmoji = duration === 0 ? e.pixel_check : e.config;

            const resultContainer = new ContainerBuilder()
                .setAccentColor(color)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn.discordapp.com/emojis/1444028041771880659.webp'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${statusEmoji} ${t('commands:slowmode.success_title')}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${t('commands:slowmode.channel')}:** <#${channel.id}>\n` +
                        `**${t('commands:slowmode.delay')}:** ${durationFormatted}\n` +
                        (duration > 0 ? `**${t('commands:slowmode.set_by')}:** ${interaction.user}` : '')
                    )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("-# Waterfall")
                );

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });

        } catch (err) {
            if (settings.debug == "true") { logger.error(err); }
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0xFF0000)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn.discordapp.com/emojis/1444028041771880659.webp'))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('common:error_occurred')}`),
                            new TextDisplayBuilder().setContent(t('commands:slowmode.error_generic', { error: err.message }))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                ).addTextDisplayComponents(
                    new TextDisplayBuilder().setContent("-# Waterfall")
                );
            await interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
    help: {
        name: "slowmode",
        description: "Set the slowmode delay for a channel",
        category: "Moderation",
        permissions: ["ManageChannels"],
        botPermissions: ["ManageChannels"],
        created: Date.now()
    }
};

// contributors: @relentiousdragon
