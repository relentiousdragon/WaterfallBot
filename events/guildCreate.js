const { Events, EmbedBuilder, WebhookClient } = require('discord.js');
const { settings } = require('../index.js');
const e = require('../data/emoji.js');
const logger = require('../logger.js');

module.exports = {
    name: Events.GuildCreate,
    async execute(bot, guild) {
        try {
            if (!settings.joinWebhook || settings.joinWebhook.length !== 2) return;

            const webhookClient = new WebhookClient({ id: settings.joinWebhook[0], token: settings.joinWebhook[1] });

            let owner = 'Unknown';
            try {
                const ownerUser = await guild.fetchOwner();
                owner = `${ownerUser.user.tag} (${ownerUser.id})`;
            } catch (err) {
                logger.warn(`Failed to fetch owner for guild ${guild.id}: ${err.message}`);
            }

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`<:i:1442933171099275377> Joined Server`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: 'Name', value: `${guild.name}`, inline: true },
                    { name: 'ID', value: `${guild.id}`, inline: true },
                    { name: 'Members', value: `${guild.memberCount}`, inline: true },
                    { name: 'Owner', value: owner, inline: false }
                )
                .setTimestamp();

            await webhookClient.send({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error in guildCreate event: ${error.message}`);
        }
    }
};
