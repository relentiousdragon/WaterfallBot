const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const users = require("../../schemas/users.js");
const e = require("../../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("vote")
        .setDescription("Vote for the bot!"),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction) {
        const userId = interaction.user.id;
        let data = await users.findOne({ userID: userId });

        if (!data) {
            data = new users({
                userID: userId,
                name: interaction.user.username
            });
            await data.save();
        }

        const currentTime = Date.now();
        const lastVoteTime = data.lastVote?.getTime() || 0;
        const lastVoteClaimTime = data.lastVoteClaim?.getTime() || 0;
        const twelveHours = 12 * 60 * 60 * 1000;

        if (currentTime - lastVoteTime >= twelveHours || (!data.lastVote && !data.lastVoteClaim)) {
            return interaction.reply({
                content: `${e.deny} You haven't voted yet. Vote for the bot at: [Top.gg](https://top.gg/bot/1435231722714169435/vote)`,
                flags: MessageFlags.Ephemeral
            });
        }

        if ((lastVoteClaimTime < lastVoteTime) || (data.lastVote != null && data.lastVoteClaim == null)) {
            data.lastVoteClaim = currentTime;
            await data.save();

            return interaction.reply({
                content: "Thank you for voting!",
                ephemeral: false
            });
        }

        if (currentTime - lastVoteTime < twelveHours) {
            const timeRemaining = lastVoteTime + twelveHours;
            return interaction.reply({
                content: `${e.deny} You already voted recently. You can Vote again <t:${Math.floor(timeRemaining / 1000)}:R>.`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "vote",
        description: "Vote for the bot!",
        category: "General",
        permissions: [],
        botPermissions: []
    }
};
