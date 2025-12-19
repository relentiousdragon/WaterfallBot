const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildEmojiUpdate,
    async execute(bot, oldEmoji, newEmoji) {
        try {
            const changes = [];

            if (oldEmoji.name !== newEmoji.name) {
                changes.push({ field: 'Name', old: oldEmoji.name, new: newEmoji.name });
            }

            if (changes.length === 0) return;

            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!newEmoji.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await newEmoji.guild.fetchAuditLogs({
                        type: AuditLogEvent.EmojiUpdate,
                        limit: 1
                    });

                    const log = auditLogs.entries.first();
                    if (log && log.target.id === newEmoji.id) {
                        moderator = log.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, newEmoji.guild.id, 'emojiUpdate', {
                oldEmoji: oldEmoji,
                newEmoji: newEmoji,
                changes: changes,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging emoji update event: ${error.message}`, error);
            }
        }
    }
};
