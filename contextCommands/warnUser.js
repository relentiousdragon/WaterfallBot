const { ContextMenuCommandBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionsBitField, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, LabelBuilder } = require("discord.js");
const e = require("../data/emoji.js");
const commandMeta = require("../util/i18n.js").getCommandMetadata();
const { processWarning } = require("../slashCommands/mod/warn.js");
//
module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName("Warn User")
        .setNameLocalizations(commandMeta.warnUser.name)
        .setType(ApplicationCommandType.User)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({
                content: `${e.deny} ${t('events:interaction.no_permission_command')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const user = interaction.targetUser;

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

        const modal = new ModalBuilder()
            .setCustomId(`warn_modal_${user.id}`)
            .setTitle(`Warn ${user.username}`);

        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500);

        const label = new LabelBuilder()
            .setLabel("Reason")
            .setTextInputComponent(reasonInput);

        modal.addLabelComponents(label);

        await interaction.showModal(modal);
    },
    async handleModal(bot, interaction, t, logger) {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({
                content: `${e.deny} ${t('events:interaction.no_permission_command')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const userId = interaction.customId.split('_')[2];
        const user = await bot.users.fetch(userId).catch(() => null);
        const reason = interaction.fields.getTextInputValue('reason');

        if (!user) {
            return interaction.reply({
                content: `${e.pixel_cross} User not found.`,
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
    },
    help: {
        name: "warnUser",
        description: "Warn a user",
        category: "Moderation",
        permissions: ["ModerateMembers"],
        botPermissions: ["ModerateMembers"],
        created: 1764938508
    }
};
