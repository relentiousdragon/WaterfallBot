const { Events, EmbedBuilder, WebhookClient } = require('discord.js');
const { settings } = require('../util/settingsModule.js');
const e = require('../data/emoji.js');
const logger = require('../logger.js');
const { i18n } = require('../util/i18n.js');
//
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

            const { Server } = require('../schemas/servers.js');

            const localeMap = {
                'en-US': 'en', 'en-GB': 'en',
                'es-ES': 'es', 'es-419': 'es',
                'pt-BR': 'pt',
                'sv-SE': 'sv',
                'zh-CN': 'zh', 'zh-TW': 'zh'
            };

            const preferredLang = localeMap[guild.preferredLocale] || 'en';

            await Server.findOneAndUpdate(
                { serverID: guild.id },
                { language: preferredLang },
                { upsert: true, new: true }
            );

            const t = i18n.getFixedT(preferredLang);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`<:i:1442933171099275377> ${t('events:guild_create.title')}`)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: t('events:guild_create.name'), value: `${guild.name}`, inline: true },
                    { name: t('events:guild_create.id'), value: `${guild.id}`, inline: true },
                    { name: t('events:guild_create.members'), value: `${guild.memberCount}`, inline: true },
                    { name: t('events:guild_create.owner'), value: owner, inline: false }
                )
                .setTimestamp();

            await webhookClient.send({ embeds: [embed] });
        } catch (error) {
            logger.error(`Error in guildCreate event: ${error.message}`);
        }
    }
};
