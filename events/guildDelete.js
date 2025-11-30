const { Events, EmbedBuilder, WebhookClient } = require('discord.js');
const { settings } = require('../index.js');
const e = require('../data/emoji.js');
const logger = require('../logger.js');
const { i18n } = require('../util/i18n.js');

module.exports = {
    name: Events.GuildDelete,
    async execute(bot, guild) {
        try {
            if (!settings.leaveWebhook || settings.leaveWebhook.length !== 2) return;

            const webhookClient = new WebhookClient({ id: settings.leaveWebhook[0], token: settings.leaveWebhook[1] });

            const t = i18n.getFixedT('en');

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle(`<:i:1442933112370761759> ${t('events:guild_delete.title')}`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: t('events:guild_delete.name'), value: `${guild.name}`, inline: true },
                    { name: t('events:guild_delete.id'), value: `${guild.id}`, inline: true },
                    { name: t('events:guild_delete.members'), value: `${guild.memberCount}`, inline: true }
                )
                .setTimestamp();

            await webhookClient.send({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error in guildDelete event: ${error.message}`);
        }
    }
};
