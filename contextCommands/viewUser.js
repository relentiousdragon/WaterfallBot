const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const e = require("../data/emoji.js");
const commandMeta = require("../util/i18n.js").getCommandMetadata();
const { generateUserProfile } = require("../slashCommands/gen/user.js");
//
module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName("View User Details")
        .setNameLocalizations(commandMeta.viewUser.name)
        .setType(ApplicationCommandType.User),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

            const target = interaction.targetUser;
            await generateUserProfile(bot, interaction, target, t, settings);

        } catch (error) {
            logger.error("Error executing command:", error);
            if (interaction.deferred) {
                return interaction.editReply({ content: `${e.pixel_cross} ${t('common:error')}` });
            } else {
                return interaction.reply({ content: `${e.pixel_cross} ${t('common:error')}`, flags: MessageFlags.Ephemeral });
            }
        }
    },
    help: {
        name: "viewUser",
        description: "View a user's details",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
