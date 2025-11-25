const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const e = require("../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("command")
        .setDescription("wat"),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger) {
        try {
            //
        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.reply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral });
        }
    },
    help: {
        name: "command",
        description: "Command description",
        category: "General",
        permissions: [],
        botPermissions: []
    }
};

// NOTE TO THE BALDASS: COMMAND FILE NAME MUST BE SAME AS COMMAND NAME ending with .js