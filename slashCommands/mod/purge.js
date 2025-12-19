const { SlashCommandBuilder, MessageFlags, PermissionsBitField, SeparatorBuilder, SeparatorSpacingSize, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } = require("discord.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const modLog = require("../../util/modLog.js");

const purgeQueue = [];
let isRunning = false;

async function bulkDeleteMessages(channel, amount, targetUserIds = null, beforeMessageId = null) {
    if (!channel.permissionsFor(channel.client.user)?.has(PermissionsBitField.Flags.ManageMessages)) {
        throw new Error("Bot lacks the required ManageMessages permission in this channel.");
    }

    let deletedCount = 0;
    let remaining = amount;

    while (remaining > 0) {
        let fetchLimit = Math.min(remaining, 100);
        let fetchOptions = { limit: fetchLimit };
        if (beforeMessageId) fetchOptions.before = beforeMessageId;

        let fetched = await channel.messages.fetch(fetchOptions).catch(() => null);
        if (!fetched || fetched.size === 0) break;

        let deletable = fetched.filter(msg =>
            (Date.now() - msg.createdTimestamp) < 14 * 24 * 60 * 60 * 1000
        );

        if (targetUserIds) {
            deletable = deletable.filter(msg => targetUserIds.includes(msg.author.id));
        }

        if (deletable.size === 0) break;

        beforeMessageId = deletable.last()?.id;

        if (deletable.size > 1) {
            await channel.bulkDelete(deletable, true).catch(() => { });
        } else {
            for (const msg of deletable.values()) await msg.delete().catch(() => { });
        }

        deletedCount += deletable.size;
        remaining -= deletable.size;
        if (remaining <= 0) break;
        await new Promise(res => setTimeout(res, 1000));
    }

    return deletedCount;
}

async function processQueue(bot, logger, t) {
    if (isRunning || purgeQueue.length === 0) return;
    isRunning = true;

    const job = purgeQueue.shift();
    const { channelId, amount, userIds, interaction, beforeMessageId } = job;

    const channel = await bot.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        if (interaction) {
            await interaction.reply({
                content: `${e.pixel_cross} ${t('commands:purge.error_channel_fetch')}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => { });
        }
        isRunning = false;
        processQueue(bot, logger, t);
        return;
    }

    if (!channel.permissionsFor(bot.user)?.has(PermissionsBitField.Flags.ManageMessages)) {
        if (interaction) {
            await interaction.reply({
                content: `${e.pixel_cross} ${t('commands:purge.error_bot_permission')}`,
                flags: MessageFlags.Ephemeral
            }).catch(() => { });
        }
        isRunning = false;
        processQueue(bot, logger, t);
        return;
    }

    if (interaction) {
        const userFilter = userIds ? t('commands:purge.user_filter', { user: `<@${userIds[0]}>` }) : '';

        const container = new ContainerBuilder()
            .setAccentColor(0x5865F2)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${e.loading} ${t('commands:purge.title_started')}`),
                        new TextDisplayBuilder().setContent(t('commands:purge.desc_started', { amount, userFilter }))
                    )
            );
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        ).addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Purge`)
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => { });
    }

    try {
        const deleted = await bulkDeleteMessages(channel, amount, userIds, beforeMessageId);

        if (interaction) {
            const container = new ContainerBuilder()
                .setAccentColor(0x18B035)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:purge.title_completed')}`),
                            new TextDisplayBuilder().setContent(t('commands:purge.desc_completed', { count: deleted }))
                        )
                );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Purge`)
            );

            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => { });
        }

        await modLog.logAction(bot, interaction.guildId, {
            action: 'PURGE',
            moderator: interaction.user,
            details: t('commands:purge.desc_completed', { count: deleted }),
            channel: channel
        });

    } catch (err) {
        if (interaction) {
            const container = new ContainerBuilder()
                .setAccentColor(0xFF4757)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.deny} ${t('commands:purge.title_failed')}`),
                            new TextDisplayBuilder().setContent(t('commands:purge.desc_failed', { error: err.message }))
                        )
                );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            ).addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Purge`)
            );
            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => { });
        }
    }

    isRunning = false;
    processQueue(bot, logger, t);
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("purge")
        .setNameLocalizations(commandMeta.purge.name)
        .setDescription("Delete messages in bulk")
        .setDescriptionLocalizations(commandMeta.purge.description)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('Number of messages to delete')
                .setDescriptionLocalizations(commandMeta.purge.option_amount)
                .setRequired(true)
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Delete messages from specific user (optional)')
                .setDescriptionLocalizations(commandMeta.purge.option_user)
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
                !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:purge.error_permission')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const channel = interaction.channel;
            if (!channel.permissionsFor(bot.user)?.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:purge.error_bot_permission')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const amount = interaction.options.getInteger('amount');
            if (!amount || amount <= 0 || amount > 2_000) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:purge.error_invalid_amount')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (amount > 200 && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:purge.error_channel_permission')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const user = interaction.options.getUser('user');
            const userIds = user ? [user.id] : null;
            const beforeMessageId = interaction.id;

            purgeQueue.push({
                channelId: interaction.channelId,
                amount,
                userIds,
                interaction,
                beforeMessageId
            });

            processQueue(bot, logger, t);

        } catch (error) {
            logger.error("Error executing purge command:", error);
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:purge.desc_failed', { error: error.message })}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "purge",
        description: "Delete messages in bulk (up to 2,000 messages)",
        category: "Moderation",
        permissions: ["ManageMessages"],
        botPermissions: ["ManageMessages"],
        created: 1764938508
    },
    bulkDeleteMessages
};
