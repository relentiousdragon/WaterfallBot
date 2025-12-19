const { PermissionFlagsBits } = require('discord.js');
const modLog = require("../util/modLog.js");
const logger = require("../logger.js");
//
module.exports = {
    name: "roleDelete",
    async execute(bot, role) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!role.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const fetchedLogs = await role.guild.fetchAuditLogs({
                        limit: 1,
                        type: 32
                    });
                    const roleLog = fetchedLogs.entries.first();
                    if (roleLog && roleLog.target.id === role.id && (Date.now() - roleLog.createdTimestamp) < 5000) {
                        moderator = roleLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, role.guild.id, 'roleDelete', {
                role: role,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (process.env.DEBUG === 'true') {
                logger.error(`Error in roleDelete event: ${error.message}`);
            }
        }
    }
};
