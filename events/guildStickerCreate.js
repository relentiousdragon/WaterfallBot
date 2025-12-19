const { PermissionFlagsBits } = require('discord.js');
const modLog = require("../util/modLog.js");
const logger = require("../logger.js");
//
module.exports = {
    name: "stickerCreate",
    async execute(bot, sticker) {
        try {
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!sticker.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const fetchedLogs = await sticker.guild.fetchAuditLogs({
                        limit: 1,
                        type: 90
                    });
                    const stickerLog = fetchedLogs.entries.first();
                    if (stickerLog && stickerLog.target.id === sticker.id && (Date.now() - stickerLog.createdTimestamp) < 5000) {
                        moderator = stickerLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, sticker.guild.id, 'stickerCreate', {
                sticker: sticker,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (process.env.DEBUG === 'true') {
                logger.error(`Error in stickerCreate event: ${error.message}`);
            }
        }
    }
};
