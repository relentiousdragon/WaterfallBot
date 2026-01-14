const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionsBitField, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const e = require("../data/emoji.js");
const commandMeta = require("../util/i18n.js").getCommandMetadata();
const modLog = require("../util/modLog.js");
const { Server } = require("../schemas/servers.js");
const Infractions = require("../schemas/infractions.js");
const { i18n } = require("../util/i18n.js");
//
module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName("Timeout 1h")
        .setNameLocalizations(commandMeta.timeout?.timeout_1h || {})
        .setType(ApplicationCommandType.User)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const serverData = await Server.findOne({ serverID: interaction.guild.id }).lean();
        const tS = i18n.getFixedT(serverData?.language || 'en');

        const user = interaction.targetUser;
        const duration = 60 * 60 * 1000;
        const reason = tS('commands:timeout.reason_quick', { duration: `1 ${tS('commands:timeout.unit_hour')}` });

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

        try {
            await member.timeout(duration, reason);

            const container = new ContainerBuilder()
                .setAccentColor(0xFFD93D)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(user.displayAvatarURL()))
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.checkmark_green} ${t('commands:timeout.success_title')}`),
                            new TextDisplayBuilder().setContent(t('commands:timeout.success_desc', { user: user.tag, duration: `1 ${t('commands:timeout.unit_hour')}` }))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.blurple_mod} ${t('commands:timeout.reason', { reason })}`),
                    new TextDisplayBuilder().setContent(`-# ${t('commands:timeout.expires', { time: Math.floor((Date.now() + duration) / 1000) })}`)
                );

            await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            /*await modLog.logEvent(bot, interaction.guildId, 'memberTimeout', {
                member: member,
                until: new Date(Date.now() + duration),
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
            logger.error("Error executing quick timeout 1h:", error);
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:timeout.error_generic', { error: error.message })}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "timeout1h",
        description: "Timeout a user for 1 hour",
        category: "Moderation",
        permissions: ["ModerateMembers"],
        botPermissions: ["ModerateMembers"],
        created: 1767295301
    }
};


// contributors: @relentiousdragon