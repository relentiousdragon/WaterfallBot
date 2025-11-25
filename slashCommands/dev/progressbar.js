const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { progressBar } = require("../../util/functions.js");
const settings = require("../../util/settings.json");
const e = require("../../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("progressbar")
        .setDescription("Generate a progress bar.  (DEV ONLY)")
        .addIntegerOption(option =>
            option.setName("min")
                .setDescription("Minimum value")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName("max")
                .setDescription("Maximum value")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName("bars")
                .setDescription("Number of bars (optional)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName("style")
                .setDescription("Style (optional)")
                .setRequired(false)
        ),
    dev: true,
    explicit: true,
    async execute(bot, interaction) {
        if (!settings.devs.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${e.deny} You don't have permission to use this command.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const min = interaction.options.getInteger("min");
        const max = interaction.options.getInteger("max");
        const bars = interaction.options.getInteger("bars");
        const color = interaction.options.getString("style");

        if (min === null || max === null) {
            return interaction.reply({
                content: `${e.pixel_warning} Minimum or Maximum value is undefined.`,
                flags: MessageFlags.Ephemeral
            });
        }
        const result = progressBar(min, max, bars, color);
        return interaction.reply({ content: `${result}` });
    },
    help: {
        name: "progressbar",
        description: "Generate a progress bar",
        category: "Dev",
        permissions: [],
        botPermissions: []
    }
};