const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildBanRemove,
    async execute(bot, ban) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!ban.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await ban.guild.fetchAuditLogs({
                        type: AuditLogEvent.MemberBanRemove,
                        limit: 1
                    });

                    const unbanLog = auditLogs.entries.first();
                    if (unbanLog && unbanLog.target.id === ban.user.id) {
                        moderator = unbanLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, ban.guild.id, 'memberUnban', {
                user: ban.user,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging unban event: ${error.message}`, error);
            }
        }
    }
};
