const { SlashCommandBuilder, MessageFlags, PermissionsBitField, ChannelType, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, WebhookClient } = require("discord.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const { Server } = require("../../schemas/servers.js");
const { settings } = require("../../util/settingsModule.js");

const LOG_GROUP_MAP = {
    'messages': 'messages',
    'members': 'members',
    'moderation': 'moderation',
    'channels': 'channels',
    'expressions': 'expressions',
    'invites': 'invites',
    'roles': 'roles'
};
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("logs")
        .setNameLocalizations(commandMeta.logs.name)
        .setDescription("Configure server logging")
        .setDescriptionLocalizations(commandMeta.logs.description)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable a log type')
                .setNameLocalizations(commandMeta.logs.enable_name)
                .setDescriptionLocalizations(commandMeta.logs.enable_description)
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Log type to configure')
                        .setDescriptionLocalizations(commandMeta.logs.option_type)
                        .setRequired(true)
                        .addChoices(
                            { name: 'Messages (Delete + Edit)', value: 'messages', name_localizations: commandMeta.logs.type_messages },
                            { name: 'Members (Join + Leave)', value: 'members', name_localizations: commandMeta.logs.type_members },
                            { name: 'Moderation (Ban + Unban + Kick + Timeout + Warn)', value: 'moderation', name_localizations: commandMeta.logs.type_moderation },
                            { name: 'Channels (Create + Update + Delete)', value: 'channels', name_localizations: commandMeta.logs.type_channels },
                            { name: 'Expressions (Emojis + Stickers)', value: 'expressions', name_localizations: commandMeta.logs.type_expressions },
                            { name: 'Invites (Create + Delete)', value: 'invites', name_localizations: commandMeta.logs.type_invites },
                            { name: 'Roles (Create + Update + Delete)', value: 'roles', name_localizations: commandMeta.logs.type_roles },
                            { name: 'All Log Types', value: 'all', name_localizations: commandMeta.logs.type_all }
                        )
                )
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to send logs to')
                        .setDescriptionLocalizations(commandMeta.logs.option_channel)
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable a log type')
                .setNameLocalizations(commandMeta.logs.disable_name)
                .setDescriptionLocalizations(commandMeta.logs.disable_description)
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Log type to disable')
                        .setDescriptionLocalizations(commandMeta.logs.option_type)
                        .setRequired(true)
                        .addChoices(
                            { name: 'Messages', value: 'messages', name_localizations: commandMeta.logs.type_messages },
                            { name: 'Members', value: 'members', name_localizations: commandMeta.logs.type_members },
                            { name: 'Moderation', value: 'moderation', name_localizations: commandMeta.logs.type_moderation },
                            { name: 'Channels', value: 'channels', name_localizations: commandMeta.logs.type_channels },
                            { name: 'Expressions', value: 'expressions', name_localizations: commandMeta.logs.type_expressions },
                            { name: 'Invites', value: 'invites', name_localizations: commandMeta.logs.type_invites },
                            { name: 'Roles', value: 'roles', name_localizations: commandMeta.logs.type_roles },
                            { name: 'All Log Types', value: 'all', name_localizations: commandMeta.logs.type_all }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Show current log configuration')
                .setNameLocalizations(commandMeta.logs.list_name)
                .setDescriptionLocalizations(commandMeta.logs.list_description)
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ignore-bots')
                .setDescription('Toggle logging of bot messages')
                .setNameLocalizations(commandMeta.logs.ignore_bots_name)
                .setDescriptionLocalizations(commandMeta.logs.ignore_bots_description)
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Whether to ignore bot messages')
                        .setDescriptionLocalizations(commandMeta.logs.option_enabled)
                        .setRequired(true)
                )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:logs.error_permission')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'enable') {
                await handleEnable(bot, interaction, t, logger);
            } else if (subcommand === 'disable') {
                await handleDisable(bot, interaction, t, logger);
            } else if (subcommand === 'list') {
                await handleList(bot, interaction, t, logger);
            } else if (subcommand === 'ignore-bots') {
                await handleIgnoreBots(bot, interaction, t, logger);
            }

        } catch (error) {
            logger.error("Error executing logs command:", error);
            return interaction.reply({
                content: `${e.pixel_cross} An error occurred while executing the command.`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "logs",
        description: "Configure server logging settings",
        category: "Moderation",
        permissions: ["ManageGuild"],
        botPermissions: ["ManageWebhooks", "ViewAuditLog"],
        created: 1764938508
    }
};

async function handleEnable(bot, interaction, t, logger) {
    const type = interaction.options.getString('type');
    const channel = interaction.options.getChannel('channel');

    if (!channel.permissionsFor(bot.user).has(PermissionsBitField.Flags.ManageWebhooks)) {
        return interaction.reply({
            content: `${e.pixel_cross} ${t('commands:logs.error_bot_permission')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) {
        return interaction.reply({
            content: `${e.pixel_cross} ${t('commands:logs.error_bot_view_audit_log')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply();

    let server = await Server.findOne({ serverID: interaction.guildId });
    if (!server) {
        server = new Server({ serverID: interaction.guildId });
    }
    if (!server.logs) server.logs = {};

    const typesToProcess = type === 'all' ? [...new Set(Object.values(LOG_GROUP_MAP))] : [LOG_GROUP_MAP[type]];
    const enabledTypes = [];
    const updatedTypes = [];
    const skippedTypes = [];

    for (const logType of typesToProcess) {
        if (server.logs[logType] && server.logs[logType].channelId) {
            if (server.logs[logType].channelId === channel.id) {
                skippedTypes.push(logType);
                continue;
            } else {
                if (server.logs[logType].webhook && server.logs[logType].webhook.length === 2) {
                    try {
                        const oldWebhook = new WebhookClient({ id: server.logs[logType].webhook[0], token: server.logs[logType].webhook[1] });
                        await oldWebhook.delete('Moving log channel');
                    } catch (err) {
                        //
                    }
                }
                updatedTypes.push(logType);
            }
        } else {
            enabledTypes.push(logType);
        }

        try {
            const webhook = await channel.createWebhook({
                name: 'Waterfall',
                avatar: bot.user.displayAvatarURL(),
                reason: `Log setup for ${logType}`
            });

            server.logs[logType] = {
                channelId: channel.id,
                webhook: [webhook.id, webhook.token]
            };
        } catch (error) {
            logger.error(`Failed to create webhook for ${logType}:`, error);
            if (type !== 'all') {
                return interaction.editReply({
                    content: `${e.pixel_cross} ${t('commands:logs.error_webhook_create', { error: error.message })}`
                });
            }
        }
    }

    await server.save();

    if (type === 'all') {
        const lines = [];
        if (enabledTypes.length > 0) lines.push(`**Enabled:** ${enabledTypes.join(', ')}`);
        if (updatedTypes.length > 0) lines.push(`**Updated:** ${updatedTypes.join(', ')}`);
        if (skippedTypes.length > 0) lines.push(`**Already Active:** ${skippedTypes.join(', ')}`);

        const container = new ContainerBuilder()
            .setAccentColor(0x6BCF7F)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.checkmark_green} Log Types in <#${channel.id}>`),
                        new TextDisplayBuilder().setContent(lines.join('\n'))
                    )
            );
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
        );
        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } else {
        let message;
        if (skippedTypes.length > 0) {
            message = `${e.info} **${type}** logs are already enabled in <#${channel.id}>.`;
        } else if (updatedTypes.length > 0) {
            message = `${e.settings_cog} **${type}** logs moved to <#${channel.id}>.`;
        } else {
            message = `${e.checkmark_green} **${type}** logs enabled in <#${channel.id}>.`;
        }

        const container = new ContainerBuilder()
            .setAccentColor(0x6BCF7F)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:logs.enable_success_title')}`),
                        new TextDisplayBuilder().setContent(message)
                    )
            );
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
        );
        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }
}

async function handleDisable(bot, interaction, t, logger) {
    const type = interaction.options.getString('type');

    await interaction.deferReply();

    const server = await Server.findOne({ serverID: interaction.guildId });
    if (!server || !server.logs) {
        return interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:logs.list_empty')}`
        });
    }

    const typesToProcess = type === 'all' ? [...new Set(Object.values(LOG_GROUP_MAP))] : [LOG_GROUP_MAP[type]];
    const disabledTypes = [];

    for (const logType of typesToProcess) {
        if (server.logs[logType]) {
            if (server.logs[logType].webhook && server.logs[logType].webhook.length === 2) {
                try {
                    const webhook = new WebhookClient({ id: server.logs[logType].webhook[0], token: server.logs[logType].webhook[1] });
                    await webhook.delete('Log disabled');
                } catch (err) {
                    if (err.code !== 10015 && settings.debug === "true") {
                        logger.error('Error deleting webhook:', err);
                    }
                }
            }

            server.logs[logType] = undefined;
            server.markModified('logs');
            disabledTypes.push(logType);
        }
    }

    await server.save();

    if (type === 'all') {
        const message = disabledTypes.length > 0
            ? `**Disabled:** ${disabledTypes.join(', ')}`
            : 'No log types were enabled.';

        const container = new ContainerBuilder()
            .setAccentColor(0xFF6B6B)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.trash_can} ${t('commands:logs.disable_all_success')}`),
                        new TextDisplayBuilder().setContent(message)
                    )
            );

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
        );


        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } else {
        const message = disabledTypes.length > 0
            ? `**${type}** logs have been disabled.`
            : `**${type}** logs were not enabled.`;

        const container = new ContainerBuilder()
            .setAccentColor(0xFF6B6B)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.trash_can} ${t('commands:logs.disable_success_title')}`),
                        new TextDisplayBuilder().setContent(message)
                    )
            );

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
        );

        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }
}

async function handleList(bot, interaction, t, logger) {
    await interaction.deferReply();

    try {
        const server = await Server.findOne({ serverID: interaction.guildId }).lean();

        const entries = [];
        const validLogGroups = [...new Set(Object.values(LOG_GROUP_MAP))];

        if (server && server.logs) {
            for (const [key, value] of Object.entries(server.logs)) {
                if (value && value.channelId && validLogGroups.includes(key)) {
                    const typeName = t(`commands:logs.type_${key}`);
                    const emoji = entries.length === 0 ? e.reply : e.reply_cont;
                    entries.push(`${emoji} **${typeName}:** <#${value.channelId}>`);
                }
            }
        }

        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# ${e.config} ${t('commands:logs.list_title')}`),
                new TextDisplayBuilder().setContent(`-# ${t('commands:logs.list_desc')}`)
            );

        const container = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addSectionComponents(section);

        if (entries.length === 0) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${t('commands:logs.list_empty')}`)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
            );
        } else {
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(entries.join('\n'))
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
            );
        }

        await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

    } catch (error) {
        logger.error('Error listing log configuration:', error);
        await interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:logs.list_error_config')}`
        });
    }
}

async function handleIgnoreBots(bot, interaction, t, logger) {
    const enabled = interaction.options.getBoolean('enabled');

    await interaction.deferReply();

    try {
        const server = await Server.findOne({ serverID: interaction.guildId });

        if (server?.logs?.ignoreBots === enabled) {
            const statusKey = enabled
                ? 'commands:logs.ignore_bots_already_enabled'
                : 'commands:logs.ignore_bots_already_disabled';

            const icon = e.info;
            const color = 0xF2C94C;

            const container = new ContainerBuilder()
                .setAccentColor(color)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${icon} ${t('commands:logs.no_changes')}`),
                            new TextDisplayBuilder().setContent(t(statusKey))
                        )
                );

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
            );

            return interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const updatedServer = await Server.findOneAndUpdate(
            { serverID: interaction.guildId },
            { 'logs.ignoreBots': enabled },
            { upsert: true, new: true }
        );

        const status = enabled
            ? t('commands:logs.ignore_bots_enabled')
            : t('commands:logs.ignore_bots_disabled');

        const color = enabled ? 0x6BCF7F : 0xFF6B6B;
        const icon = enabled ? e.checkmark_green : e.trash_can;

        const container = new ContainerBuilder()
            .setAccentColor(color)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${icon} ${t('commands:logs.logs_configured')}`),
                        new TextDisplayBuilder().setContent(status)
                    )
            );

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Logs`)
        );

        await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

    } catch (error) {
        if (settings.debug === "true") {
            logger.error('Error toggling ignore bots:', error);
        }
        await interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:logs.error_generic')}`
        });
    }
}

