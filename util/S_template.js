const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("command")
        .setNameLocalizations(commandMeta.command.name)
        .setDescription("wat")
        .setDescriptionLocalizations(commandMeta.command.description),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false, // BOT MODERATOR, USE help.permissions for user access
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            //
        } catch (error) {
            logger.error("[/COMMAND] Error executing command:", error);
            return interaction.reply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral });
        }
    },
    help: {
        name: "command",
        description: "Command description",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: Math.floor(Date.now() / 1000) // Unix timestamp
    }
};

// COMMAND FILE NAME MUST BE SAME AS COMMAND NAME ending with .js