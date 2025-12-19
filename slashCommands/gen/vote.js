const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const users = require("../../schemas/users.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const e = require("../../data/emoji.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("vote")
        .setDescription("Vote for the bot!")
        .setNameLocalizations(commandMeta.vote.name)
        .setDescriptionLocalizations(commandMeta.vote.description),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
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
                content: `${e.deny} ${t('commands:vote.not_voted')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if ((lastVoteClaimTime < lastVoteTime) || (data.lastVote != null && data.lastVoteClaim == null)) {
            data.lastVoteClaim = currentTime;
            await data.save();

            return interaction.reply({
                content: t('commands:vote.thank_you'),
                flags: MessageFlags.Ephemeral
            });
        }

        if (currentTime - lastVoteTime < twelveHours) {
            const timeRemaining = lastVoteTime + twelveHours;
            return interaction.reply({
                content: `${e.deny} ${t('commands:vote.already_voted', { time: Math.floor(timeRemaining / 1000) })}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "vote",
        description: "Vote for the bot!",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};
