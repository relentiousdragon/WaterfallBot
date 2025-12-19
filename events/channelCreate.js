const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.ChannelCreate,
    async execute(bot, channel) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await channel.guild.fetchAuditLogs({
                        type: AuditLogEvent.ChannelCreate,
                        limit: 1
                    });

                    const createLog = auditLogs.entries.first();
                    if (createLog && createLog.target.id === channel.id) {
                        moderator = createLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, channel.guild.id, 'channelCreate', {
                channel: channel,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging channel create event: ${error.message}`, error);
            }
        }
    }
};
