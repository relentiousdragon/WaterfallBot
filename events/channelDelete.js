const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.ChannelDelete,
    async execute(bot, channel) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await channel.guild.fetchAuditLogs({
                        type: AuditLogEvent.ChannelDelete,
                        limit: 1
                    });

                    const deleteLog = auditLogs.entries.first();
                    if (deleteLog && deleteLog.target.id === channel.id) {
                        moderator = deleteLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, channel.guild.id, 'channelDelete', {
                channel: channel,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging channel delete event: ${error.message}`, error);
            }
        }
    }
};
