const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildEmojiDelete,
    async execute(bot, emoji) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!emoji.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await emoji.guild.fetchAuditLogs({
                        type: AuditLogEvent.EmojiDelete,
                        limit: 1
                    });

                    const log = auditLogs.entries.first();
                    if (log && log.target.id === emoji.id) {
                        moderator = log.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, emoji.guild.id, 'emojiDelete', {
                emoji: emoji,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging emoji delete event: ${error.message}`, error);
            }
        }
    }
};
