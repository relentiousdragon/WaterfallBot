const { PermissionFlagsBits } = require('discord.js');
const modLog = require("../util/modLog.js");
const logger = require("../logger.js");
//
module.exports = {
    name: "stickerUpdate",
    async execute(bot, oldSticker, newSticker) {
        try {
            if (oldSticker.name === newSticker.name &&
                oldSticker.description === newSticker.description &&
                oldSticker.tags === newSticker.tags) {
                return;
            }
            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!newSticker.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const fetchedLogs = await newSticker.guild.fetchAuditLogs({
                        limit: 1,
                        type: 91
                    });
                    const stickerLog = fetchedLogs.entries.first();
                    if (stickerLog && stickerLog.target.id === newSticker.id && (Date.now() - stickerLog.createdTimestamp) < 5000) {
                        moderator = stickerLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, newSticker.guild.id, 'stickerUpdate', {
                oldSticker: oldSticker,
                newSticker: newSticker,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (process.env.DEBUG === 'true') {
                logger.error(`Error in stickerUpdate event: ${error.message}`);
            }
        }
    }
};
