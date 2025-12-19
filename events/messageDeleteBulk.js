const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
require("dotenv").config();

async function fetchBulkDeleteModerator(guild, targetChannelId, deletedCount) {
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        return { moderator: null, auditLogPermissionsMissing: true };
    }

    const timeThreshold = Date.now() - 5000;
    try {
        for (let i = 0; i < 5; i++) {
            const logs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MessageBulkDelete,
                limit: 1
            });

            const entry = logs.entries.first();

            if (!entry) {
                await new Promise(res => setTimeout(res, 150));
                continue;
            }

            if (entry.createdTimestamp < timeThreshold) {
                await new Promise(res => setTimeout(res, 1000));
                continue;
            }

            if (entry.executor?.id === process.env.CLIENT_ID) {
                return { moderator: 'WATERFALL_PURGE', auditLogPermissionsMissing: false };
            }

            const sameChannel = entry.target.id === targetChannelId;
            if (!sameChannel) {
                await new Promise(res => setTimeout(res, 150));
                continue;
            }
            if (sameChannel) {
                return { moderator: entry.executor, auditLogPermissionsMissing: false };
            }

            await new Promise(res => setTimeout(res, 150));
        }
    } catch (error) {
        if (error.code === 50013) {
            return { moderator: null, auditLogPermissionsMissing: true };
        }
        throw error;
    }

    return { moderator: null, auditLogPermissionsMissing: false };
}
//
module.exports = {
    name: Events.MessageBulkDelete,
    async execute(bot, messages) {
        try {
            if (messages.size === 0) return;

            const firstMessage = messages.first();
            const guild = firstMessage.guild;
            const channel = firstMessage.channel;

            if (!guild) return;

            if (settings.debug === 'true') {
                logger.debug(`[MessageDeleteBulk] Processing ${messages.size} messages in guild ${guild.id}`);
            }

            const { moderator, auditLogPermissionsMissing } = await fetchBulkDeleteModerator(
                guild,
                channel.id,
                messages.size
            );

            if (moderator === 'WATERFALL_PURGE') {
                return;
            }

            await modLog.logEvent(bot, guild.id, 'messageDelete', {
                bulk: true,
                count: messages.size,
                channel: channel,
                messages: messages,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging bulk message delete event: ${error.message}`, error);
            }
        }
    }
};
