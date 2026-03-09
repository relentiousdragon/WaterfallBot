const { SlashCommandBuilder, MessageFlags, PermissionsBitField, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require("discord.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const modLog = require("../../util/modLog.js");
const { Server } = require("../../schemas/servers.js");
const Infractions = require("../../schemas/infractions.js");
const { i18n } = require("../../util/i18n.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setNameLocalizations(commandMeta.timeout?.name || {})
        .setDescription("Timeout a user for a specific duration")
        .setDescriptionLocalizations(commandMeta.timeout?.description || {})
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(opt =>
            opt.setName('user')
                .setNameLocalizations(commandMeta.timeout?.option_user_name || {})
                .setDescription('The user to timeout')
                .setDescriptionLocalizations(commandMeta.timeout?.option_user_description || {})
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('duration')
                .setNameLocalizations(commandMeta.timeout?.option_duration_name || {})
                .setDescription('Duration (e.g. 1d 2h, 10m, 1y)')
                .setDescriptionLocalizations(commandMeta.timeout?.option_duration_description || {})
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('reason')
                .setNameLocalizations(commandMeta.timeout?.option_reason_name || {})
                .setDescription('Reason for the timeout')
                .setDescriptionLocalizations(commandMeta.timeout?.option_reason_description || {})
                .setRequired(false)
                .setMaxLength(512)
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const serverData = await Server.findOne({ serverID: interaction.guild.id }).lean().maxTimeMS(5000);
        const tS = i18n.getFixedT(serverData?.language || 'en');

        const user = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || tS('commands:timeout.reason_none');

        if (user.bot) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_bot')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_not_found')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (user.id === interaction.user.id) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_self')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (user.id === interaction.guild.ownerId) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_owner')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_hierarchy')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!member.moderatable) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_not_moderatable')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        let durationMs = funcs.parseDuration(durationStr);
        if (!durationMs || durationMs <= 0) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_invalid_duration')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const maxMs = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > maxMs) {
            durationMs = maxMs;
        }

        try {
            await member.timeout(durationMs, reason);

            const prettyDuration = funcs.formatDurationPretty(durationMs);
            const container = new ContainerBuilder()
                .setAccentColor(0xFFD93D)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:timeout.success_title')}`),
                            new TextDisplayBuilder().setContent(t('commands:timeout.success_desc', { user: user.tag, duration: prettyDuration }))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.blurple_mod} ${t('commands:timeout.reason', { reason })}`),
                    new TextDisplayBuilder().setContent(`-# ${t('commands:timeout.expires', { time: Math.floor((Date.now() + durationMs) / 1000) })}`)
                );

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            /*await modLog.logEvent(bot, interaction.guildId, 'memberTimeout', {
                member: member,
                until: new Date(Date.now() + durationMs),
                reason: reason,
                moderator: interaction.user
            });*/

            await Infractions.create({
                serverID: interaction.guildId,
                userID: user.id,
                type: 'timeout',
                reason: reason,
                moderatorID: interaction.user.id
            });

        } catch (error) {
            logger.error("Error executing timeout command:", error);
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_generic', { error: error.message })}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "timeout",
        description: "Timeout a user for a specific duration",
        category: "Moderation",
        permissions: ["ModerateMembers"],
        botPermissions: ["ModerateMembers"],
        created: 1767295301
    }
};

// contributors: @relentiousdragon