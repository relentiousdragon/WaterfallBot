const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.ThreadDelete,
    async execute(bot, thread) {
        try {
            if (!thread.guild) return;

            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!thread.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await thread.guild.fetchAuditLogs({
                        type: AuditLogEvent.ThreadDelete,
                        limit: 1
                    });

                    const log = auditLogs.entries.first();
                    if (log && log.target.id === thread.id && (Date.now() - log.createdTimestamp < 15000)) {
                        moderator = log.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, thread.guild.id, 'threadDelete', {
                thread: thread,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging thread delete event: ${error.message}`, error);
            }
        }
    }
};
