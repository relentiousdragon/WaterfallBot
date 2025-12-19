const { SlashCommandBuilder, MessageFlags, PermissionsBitField, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const modLog = require("../../util/modLog.js");
const Warns = require("../../schemas/warns.js");
const { Server } = require("../../schemas/servers.js");
const { parseEmoji } = require("../../util/functions.js");
const crypto = require("crypto");

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setNameLocalizations(commandMeta.warn.name)
        .setDescription("Manage user warnings")
        .setDescriptionLocalizations(commandMeta.warn.description)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Warn a user')
            .setNameLocalizations(commandMeta.warn.add_name)
            .setDescriptionLocalizations(commandMeta.warn.add_description)
            .addUserOption(option => option
                .setName('user')
                .setDescription('The user to warn')
                .setDescriptionLocalizations(commandMeta.warn.option_user)
                .setRequired(true)
            )
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Reason for the warning')
                .setDescriptionLocalizations(commandMeta.warn.option_reason)
                .setRequired(true)
                .setMaxLength(500)
            )
        )
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('View warnings for a user')
            .setNameLocalizations(commandMeta.warn.list_name)
            .setDescriptionLocalizations(commandMeta.warn.list_description)
            .addUserOption(option => option
                .setName('user')
                .setDescription('The user to check')
                .setDescriptionLocalizations(commandMeta.warn.option_user)
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a specific warning')
            .setNameLocalizations(commandMeta.warn.remove_name)
            .setDescriptionLocalizations(commandMeta.warn.remove_description)
            .addUserOption(option => option
                .setName('user')
                .setDescription('The user whose warning to remove')
                .setDescriptionLocalizations(commandMeta.warn.option_user)
                .setRequired(true)
            )
            .addStringOption(option => option
                .setName('warn_id')
                .setDescription('The ID of the warning to remove')
                .setDescriptionLocalizations(commandMeta.warn.option_warn_id)
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('clear')
            .setDescription('Clear all warnings for a user')
            .setNameLocalizations(commandMeta.warn.clear_name)
            .setDescriptionLocalizations(commandMeta.warn.clear_description)
            .addUserOption(option => option
                .setName('user')
                .setDescription('The user whose warnings to clear')
                .setDescriptionLocalizations(commandMeta.warn.option_user)
                .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('config')
            .setDescription('Configure warning thresholds')
            .setNameLocalizations(commandMeta.warn.config_name)
            .setDescriptionLocalizations(commandMeta.warn.config_description)
            .addIntegerOption(option => option
                .setName('threshold')
                .setDescription('Warning threshold (1-7)')
                .setDescriptionLocalizations(commandMeta.warn.option_threshold)
                .setRequired(true)
                .addChoices(
                    { name: '1 warning', value: 1 },
                    { name: '2 warnings', value: 2 },
                    { name: '3 warnings', value: 3 },
                    { name: '4 warnings', value: 4 },
                    { name: '5 warnings', value: 5 },
                    { name: '6 warnings', value: 6 },
                    { name: '7 warnings', value: 7 }
                )
            )
            .addStringOption(option => option
                .setName('action')
                .setDescription('Action to take at this threshold')
                .setDescriptionLocalizations(commandMeta.warn.option_action)
                .setRequired(true)
                .addChoices(
                    { name: 'None', value: 'none' },
                    { name: 'Timeout', value: 'timeout' },
                    { name: 'Kick', value: 'kick' },
                    { name: 'Ban', value: 'ban' }
                )
            )
            .addIntegerOption(option => option
                .setName('duration')
                .setDescription('Duration for timeout action')
                .setDescriptionLocalizations(commandMeta.warn.option_duration)
                .setRequired(false)
                .addChoices(
                    { name: '5 minutes', value: 300000 },
                    { name: '10 minutes', value: 600000 },
                    { name: '30 minutes', value: 1800000 },
                    { name: '1 hour', value: 3600000 },
                    { name: '6 hours', value: 21600000 },
                    { name: '12 hours', value: 43200000 },
                    { name: '1 day', value: 86400000 },
                    { name: '3 days', value: 259200000 },
                    { name: '1 week', value: 604800000 }
                )
            )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                await handleAddWarn(bot, interaction, t, logger);
                break;
            case 'list':
                await handleListWarns(bot, interaction, t);
                break;
            case 'remove':
                await handleRemoveWarn(bot, interaction, t, logger);
                break;
            case 'clear':
                await handleClearWarns(bot, interaction, t, logger);
                break;
            case 'config':
                await handleConfigWarns(bot, interaction, t, logger);
                break;
        }
    },
    async autocomplete(interaction, bot, settings) {
        const focusedOption = interaction.options.getFocused(true);

        if (focusedOption.name === 'warn_id') {
            const userOption = interaction.options.get('user');

            if (!userOption || !userOption.value) {
                return await interaction.respond([{
                    name: 'Please select a user first...',
                    value: 'select_user_first'
                }]);
            }

            const userId = userOption.value;

            try {
                const warnData = await Warns.findOne({
                    serverID: interaction.guildId,
                    userID: userId
                }).lean();

                if (!warnData || !warnData.warns || warnData.warns.length === 0) {
                    return await interaction.respond([{
                        name: 'No warnings found for this user',
                        value: 'no_warnings'
                    }]);
                }

                const searchValue = focusedOption.value.toLowerCase();

                let filteredWarns = warnData.warns;

                if (searchValue) {
                    filteredWarns = warnData.warns.filter(warn =>
                        warn.reason.toLowerCase().includes(searchValue) ||
                        warn.id.toLowerCase().includes(searchValue)
                    );
                }

                filteredWarns.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                const choices = filteredWarns.slice(0, 25).map((warn, index) => ({
                    name: `#${index + 1}: ${warn.reason.substring(0, 80)}${warn.reason.length > 80 ? '...' : ''}`,
                    value: warn.id
                }));

                await interaction.respond(choices);
            } catch (error) {
                await interaction.respond([{
                    name: 'Error loading warnings...',
                    value: 'error_loading'
                }]);
            }
        }
    },
    processWarning,
    handleRemoveWarn,
    help: {
        name: "warn",
        description: "Manage user warnings",
        category: "Moderation",
        permissions: ["ModerateMembers"],
        botPermissions: ["ModerateMembers"],
        created: 1764938508
    }
};

async function handleAddWarn(bot, interaction, t, logger) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    if (user.bot) {
        return interaction.reply({
            content: `${e.pixel_cross} ${t('commands:warn.error_bot')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (user.id === interaction.user.id) {
        return interaction.reply({
            content: `${e.pixel_cross} ${t('commands:warn.error_self')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:warn.error_hierarchy')}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    await processWarning(bot, interaction, user, reason, t, logger);
}

async function processWarning(bot, interaction, user, reason, t, logger) {
    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const warnId = crypto.randomBytes(4).toString('hex');

    let warnData = await Warns.findOne({
        serverID: interaction.guildId,
        userID: user.id
    });

    if (!warnData) {
        warnData = new Warns({
            serverID: interaction.guildId,
            userID: user.id,
            warns: []
        });
    }

    if (warnData.warns.length >= 7) {
        return interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:warn.max_warns_reached', { user: user.tag })}`,
            flags: MessageFlags.Ephemeral
        });
    }

    warnData.warns.push({
        id: warnId,
        reason: reason,
        moderator: {
            id: interaction.user.id,
            tag: interaction.user.tag
        },
        timestamp: new Date()
    });

    await warnData.save();

    const warnCount = warnData.warns.length;

    let serverData = await Server.findOne({ serverID: interaction.guildId }).lean();
    if (!serverData) {
        serverData = new Server({ serverID: interaction.guildId });
        await serverData.save();
        serverData = await Server.findOne({ serverID: interaction.guildId }).lean();
    }

    const thresholds = serverData.warnThresholds || new Map([
        ['1', { action: 'none', duration: 0 }],
        ['2', { action: 'timeout', duration: 1800000 }],
        ['3', { action: 'timeout', duration: 86400000 }],
        ['4', { action: 'none', duration: 0 }],
        ['5', { action: 'timeout', duration: 604800000 }],
        ['6', { action: 'none', duration: 0 }],
        ['7', { action: 'kick', duration: 0 }]
    ]);

    let actionTaken = null;
    let nextAction = null;

    const thresholdKeys = [1, 2, 3, 4, 5, 6, 7];
    for (const threshold of thresholdKeys) {
        const thresholdStr = threshold.toString();
        const config = thresholds.get ? thresholds.get(thresholdStr) : thresholds[thresholdStr];

        if (warnCount === threshold && config) {
            if (config.action === 'timeout' && config.duration > 0) {
                if (member) {
                    try {
                        await member.timeout(config.duration, `Reached ${threshold} warnings`);
                        actionTaken = {
                            action: 'timeout',
                            duration: config.duration,
                            threshold: threshold
                        };
                    } catch (error) {
                        logger.error(`Failed to timeout user ${user.id}:`, error);
                    }
                }
            } else if (config.action === 'kick') {
                if (member) {
                    try {
                        if (member.kickable) {
                            await member.kick(`Reached ${threshold} warnings`);
                            actionTaken = {
                                action: 'kick',
                                duration: 0,
                                threshold: threshold
                            };
                        }
                    } catch (error) {
                        logger.error(`Failed to kick user ${user.id}:`, error);
                    }
                }
            } else if (config.action === 'ban') {
                if (member) {
                    try {
                        if (member.bannable) {
                            await member.ban({ reason: `Reached ${threshold} warnings` });
                            actionTaken = {
                                action: 'ban',
                                duration: 0,
                                threshold: threshold
                            };
                        }
                    } catch (error) {
                        logger.error(`Failed to ban user ${user.id}:`, error);
                    }
                }
            }
        }
    }

    for (const threshold of thresholdKeys) {
        if (warnCount < threshold) {
            const thresholdStr = threshold.toString();
            const config = thresholds.get ? thresholds.get(thresholdStr) : thresholds[thresholdStr];
            if (config && (config.action === 'timeout' || config.action === 'kick' || config.action === 'ban')) {
                nextAction = {
                    action: config.action,
                    duration: config.duration,
                    threshold: threshold,
                    remaining: threshold - warnCount
                };
                break;
            }
        }
    }

    let dmSent = false;
    try {
        const dmContainer = new ContainerBuilder()
            .setAccentColor(0xFFC312)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.guild.iconURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.discord} ${t('commands:warn.dm_title', { server: interaction.guild.name })}`),
                        new TextDisplayBuilder().setContent(t('commands:warn.dm_desc', { reason: reason }))
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(t('commands:warn.dm_warn_count', { count: warnCount, threshold: 7 }))
            );

        if (nextAction) {
            let actionText = '';
            if (nextAction.action === 'timeout') {
                actionText = `timed out for ${formatDuration(nextAction.duration)}`;
            } else if (nextAction.action === 'kick') {
                actionText = `kicked`;
            } else if (nextAction.action === 'ban') {
                actionText = `banned`;
            }

            dmContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    t('commands:warn.dm_next_action', {
                        remaining: nextAction.remaining,
                        action: actionText
                    })
                )
            );
        }

        dmContainer.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Warn • <t:${Math.floor(Date.now() / 1000)}:f>`)
        );

        await user.send({
            components: [dmContainer],
            flags: MessageFlags.IsComponentsV2
        });
        dmSent = true;
    } catch (err) {
        // DM failed, ping in channel innstead
    }

    await modLog.logEvent(bot, interaction.guildId, 'memberWarn', {
        member: member || { user: user, id: user.id },
        reason: reason,
        moderator: interaction.user,
        warnCount: warnCount,
        actionTaken: actionTaken
    });

    const container = new ContainerBuilder()
        .setAccentColor(0xFFC312)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.icon_discord} ${t('commands:warn.success_title')}`),
                    new TextDisplayBuilder().setContent(t('commands:warn.success_desc', { user: user.tag, reason: reason }))
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t('commands:warn.warn_count', { count: warnCount, threshold: 7 }))
        );

    if (actionTaken) {
        let actionText = '';
        if (actionTaken.action === 'timeout') {
            actionText = `Timed out for ${formatDuration(actionTaken.duration)}`;
        } else if (actionTaken.action === 'kick') {
            actionText = `Kicked`;
        } else if (actionTaken.action === 'ban') {
            actionText = `Banned`;
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${e.checkmark_green} ${t('commands:warn.action_taken', { action: actionText })}`
            )
        );
    }

    if (nextAction && nextAction.threshold === warnCount + 1) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
        );

        let actionText = '';
        if (nextAction.action === 'timeout') {
            actionText = `timeout for ${formatDuration(nextAction.duration)}`;
        } else if (nextAction.action === 'kick') {
            actionText = `kick`;
        } else if (nextAction.action === 'ban') {
            actionText = `ban`;
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# ${e.warning} ${t('commands:warn.next_action_warning', { action: `${actionText} (at ${nextAction.threshold} warns)` })}`
            )
        );
    }

    if (!dmSent) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${t('commands:warn.dm_failed')}`)
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    ).addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Waterfall - Warn • <t:${Math.floor(Date.now() / 1000)}:f>`)
    );

    const response = {
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };

    await interaction.editReply(response);

    if (!dmSent) {
        await interaction.followUp({ content: `<@${user.id}>` });
    }
}

async function handleListWarns(bot, interaction, t) {
    const user = interaction.options.getUser('user');

    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

    const warnData = await Warns.findOne({
        serverID: interaction.guildId,
        userID: user.id
    }).lean();

    const warnCount = warnData?.warns?.length || 0;

    const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.blurple_rulebook} ${t('commands:warn.list_title', { user: user.tag })}`),
                    new TextDisplayBuilder().setContent(t('commands:warn.list_count', { count: warnCount }))
                )
        );

    if (warnCount === 0) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t('commands:warn.no_warns'))
        );
    } else {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );

        const warnsToShow = warnData.warns.slice(-10).reverse();

        for (let i = 0; i < warnsToShow.length; i++) {
            const warn = warnsToShow[i];
            const warnIndex = warnData.warns.length - i;

            container.addSectionComponents(
                new SectionBuilder()
                    .setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel(t('common:remove')).setCustomId(`warn_remove_${warn.id}_${user.id}`))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `**${t('commands:warn.warn_number', { number: warnIndex })}**\n` +
                            `-# ${e.member}: ${warn.moderator.tag} • <t:${Math.floor(warn.timestamp.getTime() / 1000)}:R>\n` +
                            `-# ${e.ID}: \`${warn.id}\`\n` +
                            `-# ${e.reply} ${t('common:reason')}: ${warn.reason}\n`
                        )
                    )
            );
        }

        if (warnData.warns.length > 10) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# ${t('commands:warn.more_warns', { count: warnData.warns.length - 10 })}`
                )
            );
        }
    }
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    ).addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
    );
    await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });
}

async function handleRemoveWarn(bot, interaction, t, logger, warnID2, userID2) {
    const member = interaction.member;

    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: `${e.pixel_cross} ${t('common:no_permission') ?? 'You do not have permission to remove warnings.'}`,
            flags: MessageFlags.Ephemeral
        });
    }

    let user = null;
    if (interaction.isChatInputCommand()) {
        user = interaction.options?.getUser('user');
    }
    let userID = user?.id;
    let warnId = interaction.options?.getString('warn_id');
    if (!warnId) {
        warnId = warnID2;
    }
    if (!userID) {
        userID = userID2;
    }
    if (!user && interaction.inGuild()) {
        const member =
            interaction.guild.members.cache.get(userID) ||
            await interaction.guild.members.fetch(userID).catch(() => null);

        if (member) {
            user = member.user;
        }
    }
    if (!user) {
        user = await bot.users.fetch(userID).catch(() => null);
    }

    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

    const warnData = await Warns.findOne({
        serverID: interaction.guildId,
        userID: userID
    });

    if (!warnData || !warnData.warns || warnData.warns.length === 0) {
        return interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:warn.no_warns_found')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const warnIndex = warnData.warns.findIndex(w => w.id === warnId);
    if (warnIndex === -1) {
        return interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:warn.warn_not_found')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const removedWarn = warnData.warns[warnIndex];
    warnData.warns.splice(warnIndex, 1);
    await warnData.save();

    await modLog.logEvent(bot, interaction.guildId, 'memberWarnRemove', {
        member: { user: user, id: userID },
        reason: removedWarn.reason,
        moderator: interaction.user,
        warnCount: warnData.warns.length
    });

    const container = new ContainerBuilder()
        .setAccentColor(0x28a745)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:warn.remove_success_title')}`),
                    new TextDisplayBuilder().setContent(
                        t('commands:warn.remove_success_desc', { user: user.tag, reason: removedWarn.reason })
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                t('commands:warn.remaining_warns', { count: warnData.warns.length })
            )
        );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    ).addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
    );

    await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });
}

async function handleClearWarns(bot, interaction, t, logger) {
    const user = interaction.options.getUser('user');

    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

    const warnData = await Warns.findOne({
        serverID: interaction.guildId,
        userID: user.id
    });

    if (!warnData || !warnData.warns || warnData.warns.length === 0) {
        return interaction.editReply({
            content: `${e.pixel_cross} ${t('commands:warn.no_warns_found')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const warnCount = warnData.warns.length;

    const container = new ContainerBuilder()
        .setAccentColor(0xff6b6b)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.warning} ${t('commands:warn.clear_confirm_title')}`),
                    new TextDisplayBuilder().setContent(
                        t('commands:warn.clear_confirm_desc', { user: user.tag, count: warnCount })
                    )
                )
        );

    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_clear')
                .setLabel(t('commands:warn.confirm'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('cancel_clear')
                .setLabel(t('commands:warn.cancel'))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(parseEmoji(e.pixel_cross))
        );

    container.addActionRowComponents(actionRow);

    const message = await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });

    const collector = message.createMessageComponentCollector({
        time: 60000,
        filter: i => i.user.id === interaction.user.id
    });

    collector.on('collect', async i => {
        await i.deferUpdate();

        if (i.customId === 'confirm_clear') {
            warnData.warns = [];
            await warnData.save();

            await modLog.logEvent(bot, interaction.guildId, 'memberWarnClear', {
                member: { user: user, id: user.id },
                moderator: interaction.user,
                clearedCount: warnCount
            });

            const successContainer = new ContainerBuilder()
                .setAccentColor(0x28a745)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:warn.clear_success_title')}`),
                            new TextDisplayBuilder().setContent(
                                t('commands:warn.clear_success_desc', { user: user.tag, count: warnCount })
                            )
                        )
                );
            successContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
            );

            await i.editReply({
                content: null,
                components: [successContainer]
            });
        } else {
            const cancelContainer = new ContainerBuilder()
                .setAccentColor(0x95a5a6)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.pixel_cross} ${t('commands:warn.clear_cancelled')}`)
                        )
                );
            cancelContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
            );

            await i.editReply({
                content: null,
                components: [cancelContainer]
            });
        }

        collector.stop();
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            const timeoutContainer = new ContainerBuilder()
                .setAccentColor(0x95a5a6)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.pixel_cross} ${t('commands:warn.clear_timeout')}`)
                        )
                );

            timeoutContainer.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
            );
            await interaction.editReply({
                content: null,
                components: [timeoutContainer]
            }).catch(() => { });
        }
    });
}

async function handleConfigWarns(bot, interaction, t, logger) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
            content: `${e.deny} ${t('commands:warn.error_admin_only')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

    let serverData = await Server.findOne({ serverID: interaction.guildId });
    if (!serverData) {
        serverData = new Server({ serverID: interaction.guildId });
        await serverData.save();
    }

    const threshold = interaction.options.getInteger('threshold');
    const action = interaction.options.getString('action');
    const duration = interaction.options.getInteger('duration');

    if (!threshold) {
        const container = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.settings_cog_blue} ${t('commands:warn.config_title')}`),
                        new TextDisplayBuilder().setContent(t('commands:warn.config_desc'))
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );

        const thresholds = serverData.warnThresholds || new Map([
            ['1', { action: 'none', duration: 0 }],
            ['2', { action: 'timeout', duration: 1800000 }],
            ['3', { action: 'timeout', duration: 86400000 }],
            ['4', { action: 'none', duration: 0 }],
            ['5', { action: 'timeout', duration: 604800000 }],
            ['6', { action: 'none', duration: 0 }],
            ['7', { action: 'kick', duration: 0 }]
        ]);

        for (const thresholdKey of ['1', '2', '3', '4', '5', '6', '7']) {
            const config = thresholds.get ? thresholds.get(thresholdKey) : thresholds[thresholdKey];
            let actionText = t('commands:warn.action_none');

            if (config.action === 'timeout') {
                actionText = `${t('commands:warn.action_timeout')}: ${formatDuration(config.duration)}`;
            } else if (config.action === 'kick') {
                actionText = t('commands:warn.action_kick');
            } else if (config.action === 'ban') {
                actionText = 'Ban';
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${thresholdKey} ${t('commands:warn.warnings')}:** ${actionText}`
                )
            );
        }

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
        );

        return interaction.editReply({
            content: null,
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    if (!serverData.warnThresholds) {
        serverData.warnThresholds = new Map([
            ['1', { action: 'none', duration: 0 }],
            ['2', { action: 'timeout', duration: 1800000 }],
            ['3', { action: 'timeout', duration: 86400000 }],
            ['4', { action: 'none', duration: 0 }],
            ['5', { action: 'timeout', duration: 604800000 }],
            ['6', { action: 'none', duration: 0 }],
            ['7', { action: 'kick', duration: 0 }]
        ]);
    }

    const thresholdStr = threshold.toString();
    const currentConfig = serverData.warnThresholds.get ?
        serverData.warnThresholds.get(thresholdStr) :
        serverData.warnThresholds[thresholdStr] || { action: 'none', duration: 0 };

    const newAction = action || currentConfig.action;

    let newDuration = 0;
    if (newAction === 'timeout') {
        newDuration = duration || currentConfig.duration || 1800000;
    }

    if (serverData.warnThresholds.set) {
        serverData.warnThresholds.set(thresholdStr, {
            action: newAction,
            duration: newDuration
        });
    } else {
        serverData.warnThresholds[thresholdStr] = {
            action: newAction,
            duration: newDuration
        };
    }

    serverData.markModified('warnThresholds');
    await serverData.save();

    let actionText = '';
    if (newAction === 'none') {
        actionText = t('commands:warn.action_none');
    } else if (newAction === 'kick') {
        actionText = t('commands:warn.action_kick');
    } else if (newAction === 'ban') {
        actionText = 'Ban';
    } else if (newAction === 'timeout') {
        actionText = `${t('commands:warn.action_timeout')}: ${formatDuration(newDuration)}`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(0x28a745)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:warn.config_updated_title')}`),
                    new TextDisplayBuilder().setContent(
                        t('commands:warn.config_updated_desc', {
                            threshold: threshold,
                            action: actionText
                        })
                    )
                )
        );
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    ).addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Waterfall - Warn`)
    );
    await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });
}