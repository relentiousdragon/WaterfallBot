const { SlashCommandBuilder, MessageFlags } = require('discord.js')
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('_leave').setDescription('Team Only')
        .addStringOption(option => option.setName('guild').setDescription('Guild').setRequired(true)),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: true,
    beta: false,
    explicit: process.env.CANARY === "true" ? false : true,
    async execute(bot, interaction, funcs, settings, logger, t) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(settings.moderators.includes(interaction.user.id))) {
            return interaction.editReply('Unauthorised!')
        }
        const guild_option = interaction.options.getString('guild')
        const guild = await interaction.client.guilds.cache.get(guild_option)
        if (!guild) {
            return interaction.editReply('No guild with that ID for the bot!')
        }
        guild.leave()
        return interaction.editReply('Done successfully')
    },
    help: {
        name: "leave",
        description: "Leave a guild",
        category: "Dev",
        permissions: ["moderator"],
        botPermissions: [],
        created: 1764938508
    }
}