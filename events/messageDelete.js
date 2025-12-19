const { Events, AuditLogEvent, MessageFlags, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
const processedMessages = new Map();
const CLEANUP_INTERVAL = 30000;

async function fetchModerator(guild, targetChannelId) {
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        return { moderator: null, auditLogPermissionsMissing: true };
    }

    const timeThreshold = Date.now() - 5000;
    try {
        for (let i = 0; i < 3; i++) {
            const logs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MessageDelete,
                limit: 1
            });

            const entry = logs.entries.first();
            const now = Date.now();

            if (!entry) {
                await new Promise(res => setTimeout(res, 150));
                continue;
            }

            if (entry.createdTimestamp < timeThreshold) {
                await new Promise(res => setTimeout(res, 250));
                continue;
            }

            const sameChannel = entry.extra?.channel?.id === targetChannelId;
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

setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of processedMessages.entries()) {
        if (now - timestamp > 10000) {
            processedMessages.delete(key);
        }
    }
}, CLEANUP_INTERVAL);
//
module.exports = {
    name: Events.MessageDelete,
    async execute(bot, message) {
        try {
            if (message.author?.id === bot.user.id) return;
            if (message.webhookId && message.author?.id === bot.user.id) return;
            const cacheKey = `${message.guild?.id}:${message.id}`;
            if (processedMessages.has(cacheKey)) {
                if (settings.debug === 'true') {
                    logger.debug(`[MessageDelete] Skipping already processed message ${message.id}`);
                }
                return;
            }

            processedMessages.set(cacheKey, Date.now());

            const isComponentsV2 = message.flags?.has(MessageFlags.IsComponentsV2) ||
                message.flags?.has(1 << 15) ||
                (message.flags?.bitfield & 32768) !== 0;

            const hasContent = message.content;
            const hasAttachments = message.attachments && message.attachments.size > 0;
            const hasEmbeds = message.embeds && message.embeds.length > 0;
            const hasComponents = message.components && message.components.length > 0;

            if (!hasContent && !hasAttachments && !hasEmbeds && !hasComponents && !isComponentsV2) return;

            const { moderator, auditLogPermissionsMissing } = await fetchModerator(
                message.guild,
                message.channel.id,
            );

            const dedupKey = `msgdel:${message.guild?.id ? message.guild.id : 0}:${message.id}`;

            await modLog.logEvent(bot, message.guild.id, 'messageDelete', {
                message: message,
                isComponentsV2: isComponentsV2,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            }, dedupKey);
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging message delete event: ${error.message}`, error);
            }
        }
    }
};