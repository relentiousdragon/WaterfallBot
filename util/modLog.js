
const { WebhookClient, EmbedBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const { Server } = require('../schemas/servers.js');
const logger = require('../logger.js');
const { i18n } = require('../util/i18n.js');
const { settings } = require('../util/settingsModule.js');

const WE = {
    add: "<:add:1442938199524769902>",
    ban: "<:ban:1442932975544307732>",
    channel: "<:channel:1446165448105132113>",
    discord: "<:discord:1445406166015279145>",
    emote: "<:emote:1446165501092036741>",
    forum: "<:forum:1446165529462181898>",
    invite: "<:invite:1446165389099798729>",
    join: "<:join:1442933171099275377>",
    leave: "<:leave:1442933112370761759>",
    locked: "<:locked_channel:1446165267859374140>",
    settings: "<:settings:1446165879388901530>",
    stage: "<:stage:1446165573171155025>",
    trash: "<:trash:1446165645967491292>",
    voice: "<:voice_channel:1446165331839025334>",
    warn: "⚠️",
    role: "<:role:1446165389099798729>"
};


const EVENT_TO_LOG_GROUP = {
    'messageDelete': 'messages',
    'messageDeleteBulk': 'messages',
    'messageEdit': 'messages',
    'memberJoin': 'members',
    'memberLeave': 'members',
    'memberRoleAdd': 'members',
    'memberRoleRemove': 'members',
    'memberNicknameChange': 'members',
    'memberBan': 'moderation',
    'memberUnban': 'moderation',
    'memberKick': 'moderation',
    'memberTimeout': 'moderation',
    'memberTimeoutRemove': 'moderation',
    'memberWarn': 'moderation',
    'channelCreate': 'channels',
    'channelUpdate': 'channels',
    'channelDelete': 'channels',
    'emojiCreate': 'expressions',
    'emojiUpdate': 'expressions',
    'emojiDelete': 'expressions',
    'stickerCreate': 'expressions',
    'stickerUpdate': 'expressions',
    'stickerDelete': 'expressions',
    'inviteCreate': 'invites',
    'inviteDelete': 'invites',
    'roleCreate': 'roles',
    'roleUpdate': 'roles',
    'roleDelete': 'roles',
    'channelHierarchyUpdate': 'channels',
    'roleHierarchyUpdate': 'roles',
    'threadDelete': 'channels',
    'threadUpdate': 'channels'
};

const PRIORITY = {
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3
};

const EVENT_PRIORITY = {
    'memberBan': PRIORITY.HIGH,
    'memberUnban': PRIORITY.HIGH,
    'memberKick': PRIORITY.HIGH,
    'memberTimeout': PRIORITY.HIGH,
    'memberTimeoutRemove': PRIORITY.HIGH,
    'memberWarn': PRIORITY.HIGH,
    'messageDelete': PRIORITY.MEDIUM,
    'messageDeleteBulk': PRIORITY.HIGH,
    'messageEdit': PRIORITY.MEDIUM,
    'channelCreate': PRIORITY.MEDIUM,
    'channelUpdate': PRIORITY.MEDIUM,
    'channelDelete': PRIORITY.MEDIUM,
    'roleCreate': PRIORITY.MEDIUM,
    'roleUpdate': PRIORITY.MEDIUM,
    'roleDelete': PRIORITY.MEDIUM,
    'memberRoleAdd': PRIORITY.MEDIUM,
    'memberRoleRemove': PRIORITY.MEDIUM,
    'memberNicknameChange': PRIORITY.MEDIUM,
    'channelHierarchyUpdate': PRIORITY.MEDIUM,
    'roleHierarchyUpdate': PRIORITY.MEDIUM,
    'threadDelete': PRIORITY.MEDIUM,
    'threadUpdate': PRIORITY.MEDIUM,
    'memberJoin': PRIORITY.LOW,
    'memberLeave': PRIORITY.LOW,
    'inviteCreate': PRIORITY.LOW,
    'inviteDelete': PRIORITY.LOW,
    'emojiCreate': PRIORITY.LOW,
    'emojiUpdate': PRIORITY.LOW,
    'emojiDelete': PRIORITY.LOW,
    'stickerCreate': PRIORITY.LOW,
    'stickerUpdate': PRIORITY.LOW,
    'stickerDelete': PRIORITY.LOW
};

const BATCHABLE_EVENTS = [
    'memberJoin', 'memberLeave', 'memberKick', 'memberBan', 'memberUnban',
    'roleDelete', 'roleCreate', 'memberTimeout', 'memberTimeoutRemove', 'memberWarn',
    'channelCreate', 'channelDelete', 'channelUpdate',
    'roleHierarchyUpdate', 'channelHierarchyUpdate', 'messageDelete', 'messageDeleteBulk'
];

const QUEUE_CONFIG = {
    BATCH_WINDOW_MS: 1650,
    BATCH_WINDOW_MS_MSG: 2750,
    DEBOUNCE_MS: 250,
    BATCH_THRESHOLD: 3,
    MAX_QUEUE_SIZE: 100,
    BASE_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 60000,
    BATCH_SIZE: 10
};

const logQueues = new Map();

const banProcessedCache = new Map();

function addToBanCache(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const timestamp = Date.now();
    banProcessedCache.set(key, timestamp);

    setTimeout(() => {
        if (banProcessedCache.get(key) === timestamp) {
            banProcessedCache.delete(key);
        }
    }, 10000);
}

function isInBanCache(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const timestamp = banProcessedCache.get(key);
    if (!timestamp) return false;

    if (Date.now() - timestamp < 10000) {
        return true;
    }

    banProcessedCache.delete(key);
    return false;
}

function getQueue(guildId, webhookKey) {
    if (!logQueues.has(guildId)) {
        logQueues.set(guildId, new Map());
    }
    const guildQueues = logQueues.get(guildId);

    if (!guildQueues.has(webhookKey)) {
        guildQueues.set(webhookKey, {
            queue: [],
            batchTimeout: null,
            retryAfter: 0,
            retryCount: 0,
            processing: false,
            lastEventTimes: new Map()
        });
    }
    return guildQueues.get(webhookKey);
}

function enqueueLog(guildId, webhookKey, logEntry) {
    if (logEntry.eventType === 'memberBan') {
        const userId = logEntry.data.user.id;
        if (isInBanCache(guildId, userId)) {
            if (settings.debug === 'true' || settings.debug === true) {
                logger.debug(`[ModLog] Skipping duplicate ban event for user ${userId}`);
            }
            return;
        }
        addToBanCache(guildId, userId);
    }

    if (settings.debug === 'true' || settings.debug === true) {
        logger.debug(`[ModLog] Enqueuing event ${logEntry.eventType} for guild ${guildId}`);
    }
    const queueData = getQueue(guildId, webhookKey);
    const { eventType } = logEntry;
    const now = Date.now();

    if (eventType === 'messageDelete') {
        const pendingMessageDelete = queueData.queue.find(e =>
            e.eventType === 'messageDelete' &&
            e.batchable &&
            (now - e.timestamp) < QUEUE_CONFIG.BATCH_WINDOW_MS_MSG
        );

        if (pendingMessageDelete) {
            pendingMessageDelete.batchCount = (pendingMessageDelete.batchCount || 1) + 1;
            pendingMessageDelete.batchData.push(logEntry.data);

            pendingMessageDelete.timestamp = now;

            if (settings.debug === 'true' || settings.debug === true) {
                logger.debug(`[ModLog] Merged message delete into existing batch (count: ${pendingMessageDelete.batchCount})`);
            }
            return;
        }
    }

    if (logEntry.dedupKey) {
        const lastDedup = queueData.lastEventTimes.get(logEntry.dedupKey);

        const existingEntry = queueData.queue.find(e => e.dedupKey === logEntry.dedupKey);

        if (existingEntry) {

            if (logEntry.data.moderator && !existingEntry.data.moderator) {
                existingEntry.data.moderator = logEntry.data.moderator;
            }

            if (logEntry.data.reason && !existingEntry.data.reason) {
                existingEntry.data.reason = logEntry.data.reason;
            }

            if (logEntry.data.member && !existingEntry.data.member) {
                existingEntry.data.member = logEntry.data.member;
            } else if (logEntry.data.member?.joinedTimestamp && !existingEntry.data.member?.joinedTimestamp) {
                if (existingEntry.data.member) {
                    existingEntry.data.member.joinedTimestamp = logEntry.data.member.joinedTimestamp;
                }
            }

            if (settings.debug === 'true' || settings.debug === true) {
                logger.debug(`[ModLog] Merged event ${logEntry.eventType} (dedupKey: ${logEntry.dedupKey})`);
            }
            return;
        }

        if (lastDedup && (now - lastDedup) < QUEUE_CONFIG.DEBOUNCE_MS) {
            if (settings.debug === 'true' || settings.debug === true) {
                logger.debug(`[ModLog] Debounced event ${logEntry.eventType} (dedupKey: ${logEntry.dedupKey})`);
            }
            return;
        }

        queueData.lastEventTimes.set(logEntry.dedupKey, now);
    }

    const lastTime = queueData.lastEventTimes.get(eventType);
    if (lastTime && (now - lastTime) < QUEUE_CONFIG.DEBOUNCE_MS) {
        const existingIdx = queueData.queue.findIndex(
            e => e.eventType === eventType && e.batchable
        );
        if (existingIdx !== -1 && BATCHABLE_EVENTS.includes(eventType)) {

            queueData.queue[existingIdx].batchCount =
                (queueData.queue[existingIdx].batchCount || 1) + 1;
            queueData.queue[existingIdx].batchData.push(logEntry.data);
            return;
        }
    }
    queueData.lastEventTimes.set(eventType, now);

    if (eventType === 'roleDelete' && logEntry.data.role?.tags?.botId) {
        const botId = logEntry.data.role.tags.botId;
        const kickBanEntry = queueData.queue.find(e =>
            (e.eventType === 'memberKick' || e.eventType === 'memberBan') &&
            e.data.user.id === botId
        );

        if (kickBanEntry) {
            const t = logEntry.t;
            const extraField = {
                name: t('modlog:auto_role_delete'),
                value: logEntry.data.role.name,
                inline: true
            };

            if (kickBanEntry.embedsToSend && kickBanEntry.embedsToSend.length > 0) {
                kickBanEntry.embedsToSend[0].addFields(extraField);
                return;
            }
        }
    }

    if (eventType === 'roleCreate') {
        let joinEntry = null;

        if (logEntry.data.role?.tags?.botId) {
            const botId = logEntry.data.role.tags.botId;
            joinEntry = queueData.queue.find(e =>
                e.eventType === 'memberJoin' &&
                e.data.member.id === botId
            );
        }

        if (!joinEntry && logEntry.data.role?.name) {
            joinEntry = queueData.queue.find(e =>
                e.eventType === 'memberJoin' &&
                e.data.member?.user?.bot &&
                (e.data.member.user.username.toLowerCase() === logEntry.data.role.name.toLowerCase())
            );
        }

        if (joinEntry) {
            const t = logEntry.t;
            const extraField = {
                name: t('modlog:auto_role_create'),
                value: logEntry.data.role.name,
                inline: true
            };

            if (joinEntry.embedsToSend && joinEntry.embedsToSend.length > 0) {
                joinEntry.embedsToSend[0].addFields(extraField);
                return;
            }
        }
    }

    if (eventType === 'memberBan' || eventType === 'memberKick') {
        const userId = logEntry.data.user.id;

        if (logEntry.data.user.bot) {
            const roleDeleteIndex = queueData.queue.findIndex(e =>
                e.eventType === 'roleDelete' &&
                e.data.role?.tags?.botId === userId
            );
            if (roleDeleteIndex !== -1) {
                const roleDeleteEvent = queueData.queue[roleDeleteIndex];
                const t = logEntry.t;
                const extraField = {
                    name: t('modlog:auto_role_delete'),
                    value: roleDeleteEvent.data.role.name,
                    inline: true
                };
                if (logEntry.embedsToSend && logEntry.embedsToSend.length > 0) {
                    logEntry.embedsToSend[0].addFields(extraField);
                }
                queueData.queue.splice(roleDeleteIndex, 1);
            }
        }

        const leaveIndex = queueData.queue.findIndex(e =>
            e.eventType === 'memberLeave' &&
            (e.data.user?.id === userId || e.data.member?.user?.id === userId)
        );

        if (leaveIndex !== -1) {
            const leaveEvent = queueData.queue[leaveIndex];
            const timeDiff = now - leaveEvent.timestamp;

            if (timeDiff < 3000) {
                if (leaveEvent.data.member) {
                    logEntry.data.member = leaveEvent.data.member;

                    if (logEntry.embedsToSend && logEntry.embedsToSend.length > 0) {
                        const embed = logEntry.embedsToSend[0];
                        const t = logEntry.t;
                        if (leaveEvent.data.member.joinedTimestamp) {
                            const timeString = `<t:${Math.floor(leaveEvent.data.member.joinedTimestamp / 1000)}:R>`;
                            const existingField = embed.data.fields?.find(f => f.name === t('modlog:joined'));
                            if (!existingField) {
                                embed.addFields({
                                    name: t('modlog:joined'),
                                    value: timeString,
                                    inline: true
                                });
                            }
                        }
                    }
                }

                queueData.queue.splice(leaveIndex, 1);

                if (settings.debug === 'true' || settings.debug === true) {
                    logger.debug(`[ModLog] Merged leave into ${eventType} for user ${userId} (time diff: ${timeDiff}ms)`);
                }
            } else {
                if (settings.debug === 'true' || settings.debug === true) {
                    logger.debug(`[ModLog] NOT merging leave into ${eventType} for user ${userId} (time diff too large: ${timeDiff}ms)`);
                }
            }
        }
    }

    if (eventType === 'memberLeave') {
        const userId = logEntry.data.user?.id || logEntry.data.member?.user?.id;
        if (userId) {
            const banKickEntry = queueData.queue.find(e =>
                (e.eventType === 'memberBan' || e.eventType === 'memberKick') &&
                e.data.user.id === userId
            );

            if (banKickEntry) {
                if (!banKickEntry.data.member && logEntry.data.member) {
                    banKickEntry.data.member = logEntry.data.member;

                    if (banKickEntry.embedsToSend && banKickEntry.embedsToSend.length > 0) {
                        const embed = banKickEntry.embedsToSend[0];
                        const t = banKickEntry.t;
                        if (logEntry.data.member.joinedTimestamp) {
                            const timeString = `<t:${Math.floor(logEntry.data.member.joinedTimestamp / 1000)}:R>`;
                            const existingField = embed.data.fields?.find(f => f.name === t('modlog:joined'));
                            if (!existingField) {
                                embed.addFields({
                                    name: t('modlog:joined'),
                                    value: timeString,
                                    inline: true
                                });
                            }
                        }
                    }
                }

                return;
            }
        }
    }

    if (eventType === 'memberJoin' && logEntry.data.member?.user?.bot) {
        const botId = logEntry.data.member.id;
        const botUsername = logEntry.data.member.user.username;

        let roleCreateIndex = -1;

        roleCreateIndex = queueData.queue.findIndex(e =>
            e.eventType === 'roleCreate' &&
            e.data.role?.tags?.botId === botId
        );

        if (roleCreateIndex === -1) {
            roleCreateIndex = queueData.queue.findIndex(e =>
                e.eventType === 'roleCreate' &&
                e.data.role?.name &&
                (e.data.role.name.toLowerCase() === botUsername.toLowerCase())
            );
        }

        if (roleCreateIndex !== -1) {
            const roleCreateEvent = queueData.queue[roleCreateIndex];
            const t = logEntry.t;
            const extraField = {
                name: t('modlog:auto_role_create'),
                value: roleCreateEvent.data.role.name,
                inline: true
            };
            if (logEntry.embedsToSend && logEntry.embedsToSend.length > 0) {
                logEntry.embedsToSend[0].addFields(extraField);
            }
            queueData.queue.splice(roleCreateIndex, 1);
        }
    }

    const priority = EVENT_PRIORITY[eventType] || PRIORITY.MEDIUM;
    const entry = {
        ...logEntry,
        priority,
        timestamp: now,
        batchable: BATCHABLE_EVENTS.includes(eventType),
        batchCount: 1,
        batchData: [logEntry.data]
    };

    const insertIdx = queueData.queue.findIndex(e => e.priority > priority);
    if (insertIdx === -1) {
        queueData.queue.push(entry);
    } else {
        queueData.queue.splice(insertIdx, 0, entry);
    }

    while (queueData.queue.length > QUEUE_CONFIG.MAX_QUEUE_SIZE) {
        queueData.queue.pop();
    }

    if (!queueData.batchTimeout && !queueData.processing) {
        queueData.batchTimeout = setTimeout(() => {
            flushQueue(guildId, webhookKey);
        }, (logEntry.eventType === 'messageDelete' ? QUEUE_CONFIG.BATCH_WINDOW_MS_MSG : QUEUE_CONFIG.BATCH_WINDOW_MS));
    }
}

async function flushQueue(guildId, webhookKey) {
    const queueData = getQueue(guildId, webhookKey);

    if (queueData.batchTimeout) {
        clearTimeout(queueData.batchTimeout);
        queueData.batchTimeout = null;
    }

    if (queueData.queue.length === 0 || queueData.processing) {
        return;
    }

    if (queueData.retryAfter > Date.now()) {
        queueData.batchTimeout = setTimeout(() => {
            flushQueue(guildId, webhookKey);
        }, queueData.retryAfter - Date.now());
        return;
    }

    queueData.processing = true;

    try {
        const toProcess = queueData.queue.splice(0, QUEUE_CONFIG.BATCH_SIZE);

        if (settings.debug === 'true' || settings.debug === true) {
            logger.debug(`[ModLog] Flushing queue for ${guildId}, ${toProcess.length} items.`);
        }

        queueData.lastFlush = Date.now();

        const batchedGroups = new Map();
        const individual = [];

        for (const entry of toProcess) {
            if (entry.batchable && BATCHABLE_EVENTS.includes(entry.eventType)) {
                const key = entry.eventType;
                if (!batchedGroups.has(key)) {
                    batchedGroups.set(key, {
                        baseEntry: entry,
                        count: entry.batchCount || 1,
                        data: [...(entry.batchData || [entry.data])],
                        timestamps: [entry.timestamp]
                    });
                } else {
                    const group = batchedGroups.get(key);
                    group.count += (entry.batchCount || 1);
                    group.data.push(...(entry.batchData || [entry.data]));
                    group.timestamps.push(entry.timestamp);
                }
            } else {
                individual.push(entry);
            }
        }

        for (const [eventType, group] of batchedGroups) {
            if (eventType === 'messageDelete' && group.count > 2) {
                const combinedEntry = {
                    ...group.baseEntry,
                    batchCount: group.count,
                    batchData: group.data
                };

                try {
                    await sendBatchedLog(combinedEntry);
                    queueData.retryCount = 0;
                } catch (error) {
                    await handleSendError(error, guildId, webhookKey, combinedEntry);
                }
            }
            else if ((eventType === 'memberBan' || eventType === 'memberKick') && group.count > 1) {
                const timeRange = Math.max(...group.timestamps) - Math.min(...group.timestamps);

                if (timeRange < 3000) {
                    const combinedEntry = {
                        ...group.baseEntry,
                        batchCount: group.count,
                        batchData: group.data
                    };

                    try {
                        await sendBatchedLog(combinedEntry);
                        queueData.retryCount = 0;
                    } catch (error) {
                        await handleSendError(error, guildId, webhookKey, combinedEntry);
                    }
                } else {
                    for (let i = 0; i < group.data.length; i++) {
                        const singleEntry = {
                            ...group.baseEntry,
                            data: group.data[i],
                            embedsToSend: [group.baseEntry.embedsToSend?.[i] || group.baseEntry.embedsToSend?.[0]]
                        };

                        try {
                            await sendIndividualLog(singleEntry);
                            queueData.retryCount = 0;
                        } catch (error) {
                            await handleSendError(error, guildId, webhookKey, singleEntry);
                        }
                    }
                }
            }
            else if (group.count > 1) {
                const combinedEntry = {
                    ...group.baseEntry,
                    batchCount: group.count,
                    batchData: group.data
                };

                try {
                    await sendBatchedLog(combinedEntry);
                    queueData.retryCount = 0;
                } catch (error) {
                    await handleSendError(error, guildId, webhookKey, combinedEntry);
                }
            } else {
                try {
                    await sendIndividualLog(group.baseEntry);
                    queueData.retryCount = 0;
                } catch (error) {
                    await handleSendError(error, guildId, webhookKey, group.baseEntry);
                }
            }
        }
        for (const entry of individual) {
            try {
                await sendIndividualLog(entry);
                queueData.retryCount = 0;
            } catch (error) {
                await handleSendError(error, guildId, webhookKey, entry);
            }
        }
    } finally {
        queueData.processing = false;

        if (queueData.queue.length > 0 && !queueData.batchTimeout) {
            queueData.batchTimeout = setTimeout(() => {
                flushQueue(guildId, webhookKey);
            }, (logEntry.eventType === 'messageDelete' ? QUEUE_CONFIG.BATCH_WINDOW_MS_MSG : QUEUE_CONFIG.BATCH_WINDOW_MS));
        }
    }
}

async function handleSendError(error, guildId, webhookKey, entry) {
    const queueData = getQueue(guildId, webhookKey);

    if (error.status === 429 || error.httpStatus === 429) {
        const retryAfter = error.retryAfter || (error.retry_after * 1000) || QUEUE_CONFIG.BASE_RETRY_DELAY;
        queueData.retryAfter = Date.now() + retryAfter;
        queueData.retryCount++;

        queueData.queue.unshift(entry);

        const delay = Math.min(
            retryAfter * Math.pow(2, queueData.retryCount - 1),
            QUEUE_CONFIG.MAX_RETRY_DELAY
        );

        logger.warn(`[ModLog] Rate limited for guild ${guildId}, retrying in ${delay}ms`);

        if (queueData.batchTimeout) clearTimeout(queueData.batchTimeout);
        queueData.batchTimeout = setTimeout(() => {
            flushQueue(guildId, webhookKey);
        }, delay);
    } else {
        if (error.code === 10015 || error.message?.includes('Unknown Webhook')) {
            const [logGroup] = webhookKey.split(':');
            if (logGroup) {
                try {
                    logger.warn(`[ModLog] "Unknown Webhook" detected for guild ${guildId} (Group: ${logGroup}). Removing from DB.`);

                    await Server.findOneAndUpdate(
                        { serverID: guildId },
                        { $unset: { [`logs.${logGroup}`]: "" } }
                    );

                    logQueues.get(guildId)?.delete(webhookKey);
                } catch (dbError) {
                    logger.error(`[ModLog] Failed to remove invalid webhook from DB: ${dbError.message}`);
                }
            }
        }

        logger.error(`[ModLog] Error sending log: ${error.message}`);
    }
}

async function sendBatchedLog(entry) {
    const { webhookClient, bot, t, eventType, batchCount, batchData } = entry;

    if (settings.debug === 'true' || settings.debug === true) {
        logger.debug(`[ModLog] Sending batched log: ${eventType} (count: ${batchCount})`);
    }

    const embed = new EmbedBuilder()
        .setColor(getBatchColor(eventType))
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    if (eventType === 'messageDelete') {
        embed.setTitle(`${WE.trash} ${batchCount} ${t('modlog:messages_deleted') || 'Messages Deleted'}`);

        const channelGroups = new Map();
        const userCounts = new Map();
        let dominantModerator = null;
        let maxModCount = 0;
        const modCounts = new Map();

        for (const data of batchData) {
            const channelId = data.message?.channel?.id || 'unknown';
            const channelName = data.message?.channel?.name || 'Unknown Channel';
            if (!channelGroups.has(channelId)) {
                channelGroups.set(channelId, {
                    name: channelName,
                    count: 0,
                    users: new Set()
                });
            }
            const channelGroup = channelGroups.get(channelId);
            channelGroup.count++;

            if (data.message?.author) {
                const userId = data.message.author.id;
                channelGroup.users.add(userId);
                userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
            }

            if (data.moderator) {
                const modId = data.moderator.id;
                const current = modCounts.get(modId) || { mod: data.moderator, count: 0 };
                current.count++;
                modCounts.set(modId, current);

                if (current.count > maxModCount) {
                    maxModCount = current.count;
                    dominantModerator = data.moderator;
                }
            }
        }

        const descriptionLines = [];

        for (const [channelId, group] of channelGroups) {
            let line = t('modlog:messages_deleted_in_channel', {
                count: group.count,
                channel: `<#${channelId}>`
            });

            if (group.users.size > 0) {
                line += ' ' + t('modlog:from_users', { count: group.users.size });
            }

            descriptionLines.push(line);
        }

        embed.setDescription(descriptionLines.join('\n'));

        if (dominantModerator) {
            embed.addFields({
                name: t('modlog:moderator'),
                value: `${dominantModerator.tag} (${dominantModerator.id})`,
                inline: true
            });
        }

        if (channelGroups.size > 1) {
            embed.addFields({
                name: t('modlog:summary'),
                value: t('modlog:total_messages_deleted', { count: batchCount }),
                inline: true
            });
        }
    } else if (eventType === 'channelUpdate') {
        const descriptionLines = [];
        const MAX_LINE_LENGTH = 200;
        const MAX_DESC_LENGTH = 3500;
        let currentLength = 0;

        embed.setTitle(`${getBatchEmoji(eventType)} ${batchCount} ${getBatchTitle(eventType, t)}`);

        for (const data of batchData) {
            const channelName = data.newChannel?.name || 'Unknown Channel';
            let changeStrings = [];

            if (data.changes && Array.isArray(data.changes)) {
                for (const change of data.changes) {
                    let str = `${change.field}: ${change.old} ➔ ${change.new}`;
                    if (str.length > MAX_LINE_LENGTH) str = str.substring(0, MAX_LINE_LENGTH - 3) + '...';
                    changeStrings.push(str);
                }
            }

            let line = `• #${channelName}`;
            if (changeStrings.length > 0) line += ' - ' + changeStrings.join(', ');

            if (currentLength + line.length > MAX_DESC_LENGTH) {
                descriptionLines.push(`**+ ${batchData.length - descriptionLines.length} others...**`);
                break;
            }

            descriptionLines.push(line);
            currentLength += line.length + 1;
        }

        embed.setDescription(descriptionLines.join('\n'));

        const mod = batchData.find(d => d.moderator)?.moderator;
        if (mod) {
            embed.addFields({
                name: t('modlog:moderator') || 'Moderator',
                value: `${mod.tag} (${mod.id})`,
                inline: true
            });
        }

        if (batchData.length > 1) {
            embed.addFields({
                name: t('modlog:summary') || 'Summary',
                value: `${batchData.length} channels updated`,
                inline: true
            });
        }
    } else {
        embed.setTitle(`${getBatchEmoji(eventType)} ${batchCount} ${getBatchTitle(eventType, t)}`);

        const modCounts = new Map();
        let dominantModerator = null;
        let maxModCount = 0;

        const reasonCounts = new Map();
        let dominantReason = null;
        let maxReasonCount = 0;

        for (const data of batchData) {
            if (data.moderator) {
                const modId = data.moderator.id;
                const current = modCounts.get(modId) || { mod: data.moderator, count: 0 };
                current.count++;
                modCounts.set(modId, current);

                if (current.count > maxModCount) {
                    maxModCount = current.count;
                    dominantModerator = data.moderator;
                }
            }

            if (data.reason) {
                const r = data.reason;
                const current = reasonCounts.get(r) || 0;
                reasonCounts.set(r, current + 1);

                if (current + 1 > maxReasonCount) {
                    maxReasonCount = current + 1;
                    dominantReason = r;
                }
            }
        }

        const summaryLines = [];
        let currentLength = 0;
        const MAX_DESC_LENGTH = 3500;
        let itemsShown = 0;

        for (let i = 0; i < batchData.length; i++) {
            const data = batchData[i];
            let line = '• Unknown';
            if (data.user) line = `• ${data.user.tag}`;
            else if (data.member?.user) line = `• ${data.member.user.tag}`;
            else if (data.role) line = `• ${data.role.name}`;
            else if (data.channel) line = `• ${data.channel.name}`;
            else if (data.message?.author) line = `• ${data.message.author.tag}`;

            if (currentLength + line.length + 50 > MAX_DESC_LENGTH) {
                summaryLines.push(`**+ ${batchData.length - itemsShown} others...**`);
                break;
            }

            summaryLines.push(line);
            currentLength += line.length + 1;
            itemsShown++;
        }

        embed.setDescription(summaryLines.join('\n'));

        if (dominantModerator) {
            embed.addFields({
                name: t('modlog:moderator'),
                value: `${dominantModerator.tag} (${dominantModerator.id})`,
                inline: true
            });
        }

        if (dominantReason) {
            embed.addFields({
                name: t('modlog:reason'),
                value: dominantReason,
                inline: true
            });
        }
    }

    await webhookClient.send({
        embeds: [embed],
        username: 'Waterfall',
        avatarURL: bot.user.displayAvatarURL()
    });
}

async function sendIndividualLog(entry) {
    const { webhookClient, bot, embedsToSend, filesToSend, extraPayloads, eventType } = entry;

    if (settings.debug === 'true' || settings.debug === true) {
        const messageId = entry.data?.message?.id;
        logger.debug(`[ModLog] SENDING individual ${eventType} for message ${messageId} to webhook`);
    }

    try {
        await webhookClient.send({
            embeds: embedsToSend,
            files: filesToSend || [],
            username: 'Waterfall',
            avatarURL: bot.user.displayAvatarURL()
        });

        if (settings.debug === 'true' || settings.debug === true) {
            logger.debug(`[ModLog] SUCCESS sent ${eventType} for message ${entry.data?.message?.id}`);
        }
    } catch (error) {
        logger.error(`[ModLog] FAILED to send ${eventType}: ${error.message}`);
        throw error;
    }
}

function getBatchTitle(eventType, t) {
    const titles = {
        'memberJoin': t('modlog:members_joined') || 'Members Joined',
        'memberLeave': t('modlog:members_left') || 'Members Left',
        'memberKick': t('modlog:members_kicked') || 'Members Kicked',
        'memberBan': t('modlog:members_banned') || 'Members Banned',
        'memberUnban': t('modlog:members_unbanned') || 'Members Unbanned',
        'roleDelete': t('modlog:roles_deleted') || 'Roles Deleted',
        'roleCreate': t('modlog:roles_created') || 'Roles Created',
        'memberTimeout': t('modlog:members_timed_out') || 'Members Timed Out',
        'memberTimeoutRemove': t('modlog:timeouts_removed') || 'Timeouts Removed',
        'memberWarn': t('modlog:members_warned') || 'Members Warned',
        'channelCreate': t('modlog:channels_created') || 'Channels Created',
        'channelDelete': t('modlog:channels_deleted') || 'Channels Deleted',
        'channelUpdate': t('modlog:channels_updated') || 'Channels Updated',
        'messageDelete': t('modlog:messages_deleted') || 'Messages Deleted',
        'messageEdit': t('modlog:messages_edited') || 'Messages Edited'
    };
    return titles[eventType] || 'Events';
}

function getBatchColor(eventType) {
    const colors = {
        'memberJoin': 0x6BCF7F,
        'memberLeave': 0xFF9999,
        'memberKick': 0xFFA502,
        'memberBan': 0xFF4757,
        'memberUnban': 0x6BCF7F,
        'roleDelete': 0xFF6B6B,
        'roleCreate': 0x6BCF7F,
        'memberTimeout': 0xFFA502,
        'memberTimeoutRemove': 0x6BCF7F,
        'memberWarn': 0xFFA502,
        'channelCreate': 0x6BCF7F,
        'channelDelete': 0xFF6B6B,
        'channelUpdate': 0xFFA502,
        'messageDelete': 0xFF6B6B,
        'messageEdit': 0xFFD93D
    };
    return colors[eventType] || 0x5865F2;
}

function getBatchEmoji(eventType) {
    const emojis = {
        'memberJoin': WE.join,
        'memberLeave': WE.leave,
        'memberKick': WE.leave,
        'memberBan': WE.ban,
        'memberUnban': WE.add,
        'roleDelete': WE.trash,
        'roleCreate': WE.add,
        'memberTimeout': WE.warn,
        'memberTimeoutRemove': WE.add,
        'memberWarn': WE.warn,
        'channelCreate': WE.add,
        'channelDelete': WE.trash,
        'channelUpdate': WE.channel,
        'messageDelete': WE.trash,
        'messageEdit': WE.emote
    };
    return emojis[eventType] || WE.settings;
}

async function logAction(bot, guildId, data) {
    try {
        const server = await Server.findOne({ serverID: guildId }).lean();
        if (!server || !server.logs) return;

        const t = i18n.getFixedT(server.language || 'en');

        const logConfig = server.logs.moderation;
        if (!logConfig?.webhook || logConfig.webhook.length !== 2) return;

        const webhookClient = new WebhookClient({ id: logConfig.webhook[0], token: logConfig.webhook[1] });

        const embed = new EmbedBuilder()
            .setColor(getColorForAction(data.action))
            .setTitle(`${getEmojiForAction(data.action)} ${data.action}`)
            .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
            .setTimestamp();

        if (data.moderator) {
            embed.addFields({ name: t('modlog:moderator'), value: `${data.moderator.tag} (${data.moderator.id})`, inline: true });
        }

        if (data.target) {
            embed.addFields({ name: t('modlog:target'), value: `${data.target.tag || data.target} (${data.target.id || 'N/A'})`, inline: true });
        }

        if (data.channel) {
            embed.addFields({ name: t('modlog:channel'), value: `<#${data.channel.id}>`, inline: true });
        }

        if (data.details) {
            embed.setDescription(data.details);
        }

        if (data.reason) {
            embed.addFields({ name: t('modlog:reason'), value: data.reason });
        }

        await webhookClient.send({
            embeds: [embed],
            username: 'Waterfall',
            avatarURL: bot.user.displayAvatarURL()
        });
    } catch (error) {
        logger.error(`Error logging moderation action: ${error.message}`);
    }
}

async function logEvent(bot, guildId, eventType, data, providedDedupKey) {
    if (settings.debug === 'true' || settings.debug === true) {
        logger.debug(`[ModLog] Event Triggered: ${eventType} for guild ${guildId} with dedupKey: ${providedDedupKey}`);
    }
    try {
        const server = await Server.findOne({ serverID: guildId }).lean();
        if (!server || !server.logs) return;

        const t = i18n.getFixedT(server.language || 'en');

        const logGroup = EVENT_TO_LOG_GROUP[eventType];
        if (!logGroup) return;

        const logConfig = server.logs[logGroup];
        if (!logConfig?.webhook || logConfig.webhook.length !== 2) return;

        if (server.logs.ignoreBots && data.message?.author?.bot) return;
        if (server.logs.ignoreBots && data.newMessage?.author?.bot) return;

        const webhookClient = new WebhookClient({ id: logConfig.webhook[0], token: logConfig.webhook[1] });
        const webhookKey = `${logGroup}:${logConfig.webhook[0]}`;
        let dedupKey = providedDedupKey || null;

        let result;

        switch (eventType) {
            case 'messageDelete':
                if (data.bulk) {
                    result = await buildBulkMessageDeleteEmbed(data, bot, t);
                } else {
                    result = await buildMessageDeleteEmbed(data, bot, t);
                }
                break;
            case 'messageEdit':
                result = await buildMessageEditEmbed(data, bot, t);
                break;
            case 'memberJoin':
                result = { embed: buildMemberJoinEmbed(data, bot, t) };
                break;
            case 'memberLeave':
                result = { embed: buildMemberLeaveEmbed(data, bot, t) };
                break;
            case 'memberBan':
                result = { embed: buildMemberBanEmbed(data, bot, t) };
                dedupKey = `ban:${data.user.id}`;
                break;
            case 'memberUnban':
                result = { embed: buildMemberUnbanEmbed(data, bot, t) };
                break;
            case 'channelHierarchyUpdate':
                result = { embed: buildChannelHierarchyEmbed(data, bot, t) };
                break;
            case 'roleHierarchyUpdate':
                result = { embed: buildRoleHierarchyEmbed(data, bot, t) };
                break;
            case 'memberKick':
                result = { embed: buildMemberKickEmbed(data, bot, t) };
                break;
            case 'memberTimeout':
                result = { embed: buildMemberTimeoutEmbed(data, bot, t) };
                break;
            case 'memberTimeoutRemove':
                result = { embed: buildMemberTimeoutRemoveEmbed(data, bot, t) };
                break;
            case 'channelCreate':
                result = { embed: buildChannelCreateEmbed(data, t) };
                break;
            case 'channelUpdate':
                result = { embed: buildChannelUpdateEmbed(data, t) };
                break;
            case 'channelDelete':
                result = { embed: buildChannelDeleteEmbed(data, t) };
                break;
            case 'emojiCreate':
                result = { embed: buildEmojiCreateEmbed(data, t) };
                break;
            case 'emojiUpdate':
                result = { embed: buildEmojiUpdateEmbed(data, t) };
                break;
            case 'emojiDelete':
                result = { embed: buildEmojiDeleteEmbed(data, t) };
                break;
            case 'inviteCreate':
                result = { embed: buildInviteCreateEmbed(data, t) };
                break;
            case 'inviteDelete':
                result = { embed: buildInviteDeleteEmbed(data, t) };
                break;
            case 'memberWarn':
                result = { embed: buildMemberWarnEmbed(data, bot, t) };
                break;
            case 'memberWarnRemove':
                result = { embed: buildMemberWarnRemoveEmbed(data, bot, t) };
                break;
            case 'memberWarnClear':
                result = { embed: buildMemberWarnClearEmbed(data, bot, t) };
                break;
            case 'memberRoleAdd':
                result = { embed: buildMemberRoleAddEmbed(data, bot, t) };
                break;
            case 'memberRoleRemove':
                result = { embed: buildMemberRoleRemoveEmbed(data, bot, t) };
                break;
            case 'memberNicknameChange':
                result = { embed: buildMemberNicknameChangeEmbed(data, bot, t) };
                break;
            case 'roleCreate':
                result = { embed: buildRoleCreateEmbed(data, t) };
                break;
            case 'roleUpdate':
                result = { embed: buildRoleUpdateEmbed(data, t) };
                break;
            case 'roleDelete':
                result = { embed: buildRoleDeleteEmbed(data, t) };
                break;
            case 'stickerCreate':
                result = { embed: buildStickerCreateEmbed(data, t) };
                break;
            case 'stickerUpdate':
                result = { embed: buildStickerUpdateEmbed(data, t) };
                break;
            case 'stickerDelete':
                result = { embed: buildStickerDeleteEmbed(data, t) };
                break;
            case 'threadDelete':
                result = { embed: buildThreadDeleteEmbed(data, t) };
                break;
            case 'threadUpdate':
                result = { embed: buildThreadUpdateEmbed(data, t) };
                break;
            default:
                return;
        }

        if (!result || (!result.embed && !result.embeds)) return;

        const embedsToSend = result.embeds || [result.embed];
        const filesToSend = result.files || [];

        if (data.auditLogPermissionsMissing) {
            embedsToSend[0].addFields({
                name: i18n.t('modlog:audit_log_warning_title'),
                value: i18n.t('modlog:audit_log_warning_value'),
                inline: false
            });
        }

        enqueueLog(guildId, webhookKey, {
            eventType,
            data,
            webhookClient,
            bot,
            t,
            embedsToSend,
            filesToSend,
            extraPayloads: result.extraPayloads,
            dedupKey
        });

    } catch (error) {
        logger.error(`Error logging event ${eventType}: ${error.message}`);
    }
}

async function buildMessageDeleteEmbed(data, bot, t) {
    const { message } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:message_deleted')}`)
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    if (message.author) {
        embed.setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL()
        });
        embed.addFields({ name: t('modlog:author'), value: `${message.author.tag} (${message.author.id})`, inline: true });
    }

    if (message.channel) {
        embed.addFields({ name: t('modlog:channel'), value: `<#${message.channel.id}>`, inline: true });
    }

    embed.addFields({ name: t('modlog:message_id'), value: message.id, inline: true });

    if (data.moderator) {
        embed.addFields({
            name: t('modlog:deleted_by') || 'Deleted By',
            value: `${data.moderator.tag} (${data.moderator.id})`,
            inline: true
        });
    }

    const isComponentsV2 = message.flags?.has('IsComponentsV2') ||
        (!message.content && message.components?.length > 0 && message.embeds?.length === 0);

    if (isComponentsV2) {
        embed.addFields({ name: t('modlog:content'), value: `*${t('modlog:components_v2_message')}*` });
    } else if (message.content) {
        const content = message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content;
        embed.addFields({ name: t('modlog:content'), value: content || '*No text content*' });
    }

    if (message.attachments && message.attachments.size > 0) {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        const imageAttachments = message.attachments.filter(att =>
            imageExtensions.some(ext => att.name?.toLowerCase().endsWith(ext)) ||
            att.contentType?.startsWith('image/')
        );
        const otherAttachments = message.attachments.filter(att =>
            !imageExtensions.some(ext => att.name?.toLowerCase().endsWith(ext)) &&
            !att.contentType?.startsWith('image/')
        );

        if (imageAttachments.size === 1) {
            const img = imageAttachments.first();
            embed.setImage(img.url);
        } else if (imageAttachments.size > 1) {
            const imageList = imageAttachments.map(att => `[${att.name}](${att.url})`).join('\n');
            embed.addFields({ name: t('modlog:images') || 'Images', value: imageList });
        }

        if (otherAttachments.size > 0) {
            const attachmentList = otherAttachments.map(att => `[${att.name}](${att.url})`).join('\n');
            embed.addFields({ name: t('modlog:attachments'), value: attachmentList });
        }
    }

    const files = [];
    const embedsToSend = [embed];
    const extraPayloads = [];

    const isUserMessage = message.author && !message.author.bot && !message.webhookId;

    if (message.embeds && message.embeds.length > 0 && !isUserMessage) {
        let embedsFit = true;

        const normalEmbeds = [];
        const v2Embeds = [];

        for (const msgEmbed of message.embeds) {
            if (msgEmbed.data.type === 'rich' && (msgEmbed.data.flags || msgEmbed.data.components)) {
                v2Embeds.push(msgEmbed);
            } else {
                normalEmbeds.push(msgEmbed);
            }
        }

        if (embedsToSend.length + normalEmbeds.length > 10) embedsFit = false;

        if (embedsFit) {
            for (const msgEmbed of normalEmbeds) {
                const embedData = reconstructEmbed(msgEmbed);
                delete embedData.video;
                delete embedData.provider;
                embedData.type = 'rich';
                embedsToSend.push(new EmbedBuilder(embedData));
            }
            if (normalEmbeds.length > 0) {
                embed.addFields({ name: t('modlog:embeds'), value: t('modlog:embeds_attached', { count: normalEmbeds.length }) });
            }
        } else {
            for (let i = 0; i < normalEmbeds.length; i++) {
                const msgEmbed = normalEmbeds[i];
                const embedData = reconstructEmbed(msgEmbed);
                const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(embedData, null, 2)), {
                    name: `embed_${i + 1}.json`
                });
                files.push(attachment);
            }
            embed.addFields({ name: t('modlog:embeds'), value: t('modlog:embeds_attached', { count: normalEmbeds.length }) });
        }

        for (const v2Embed of v2Embeds) {
            const embedData = reconstructEmbed(v2Embed);
            delete embedData.video;
            delete embedData.provider;

            const payload = {
                embeds: [new EmbedBuilder(embedData)],
                IsComponentsV2: true
            };

            if (message.components && message.components.length > 0) {
                payload.components = message.components;
            }

            extraPayloads.push(payload);
        }
    }



    if (message.components && message.components.length > 0 && extraPayloads.length === 0) {
        const componentsData = message.components.map(c => c.toJSON());
        const jsonString = JSON.stringify(componentsData, null, 2);

        if (jsonString.length < 1000) {
            embed.addFields({ name: t('modlog:components'), value: `\`\`\`json\n${jsonString}\n\`\`\`` });
        } else {
            const attachment = new AttachmentBuilder(Buffer.from(jsonString), {
                name: 'components.json'
            });
            files.push(attachment);
            embed.addFields({ name: t('modlog:components'), value: t('modlog:components_attached', { count: message.components.length }) });
        }
    }

    return { embed: embedsToSend[0], embeds: embedsToSend, files, extraPayloads };
}

async function buildMessageEditEmbed(data, bot, t) {
    const { oldMessage, newMessage } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFFD93D)
        .setTitle(`${WE.emote} ${t('modlog:message_edited')}`)
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    if (newMessage.author) {
        embed.setAuthor({
            name: newMessage.author.tag,
            iconURL: newMessage.author.displayAvatarURL()
        });
        embed.addFields({ name: t('modlog:author'), value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: true });
    }

    if (newMessage.channel) {
        embed.addFields({ name: t('modlog:channel'), value: `<#${newMessage.channel.id}>`, inline: true });
    }

    embed.addFields({ name: t('modlog:jump_to_message'), value: `[Click Here](${newMessage.url})`, inline: true });

    const oldContent = oldMessage.content?.length > 1024 ? oldMessage.content.substring(0, 1021) + '...' : (oldMessage.content || '*No text content*');
    const newContent = newMessage.content?.length > 1024 ? newMessage.content.substring(0, 1021) + '...' : (newMessage.content || '*No text content*');

    embed.addFields(
        { name: t('modlog:before'), value: oldContent },
        { name: t('modlog:after'), value: newContent }
    );

    const files = [];
    const embedsToSend = [embed];
    const extraPayloads = [];

    const isUserMessage = newMessage.author && !newMessage.author.bot && !newMessage.webhookId;

    const newNormalEmbeds = [];
    const newV2Embeds = [];

    if (newMessage.embeds && newMessage.embeds.length > 0 && !isUserMessage) {
        for (const msgEmbed of newMessage.embeds) {
            if (msgEmbed.data.type === 'rich' && (msgEmbed.data.flags || msgEmbed.data.components)) {
                newV2Embeds.push(msgEmbed);
            } else {
                newNormalEmbeds.push(msgEmbed);
            }
        }
    }

    if (newNormalEmbeds.length > 0) {
        let embedsFit = true;
        if (embedsToSend.length + newNormalEmbeds.length > 10) embedsFit = false;

        if (embedsFit) {
            for (const msgEmbed of newNormalEmbeds) {
                const embedData = reconstructEmbed(msgEmbed);
                delete embedData.video;
                delete embedData.provider;
                embedsToSend.push(new EmbedBuilder(embedData));
            }
            embed.addFields({ name: t('modlog:embed_changes'), value: t('modlog:changes_attached') });
        } else {
            for (let i = 0; i < newNormalEmbeds.length; i++) {
                const msgEmbed = newNormalEmbeds[i];
                const embedData = reconstructEmbed(msgEmbed);
                const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(embedData, null, 2)), {
                    name: `new_embed_${i + 1}.json`
                });
                files.push(attachment);
            }
            embed.addFields({ name: t('modlog:embed_changes'), value: t('modlog:changes_attached') });
        }
    }

    for (const v2Embed of newV2Embeds) {
        const embedData = reconstructEmbed(v2Embed);
        delete embedData.video;
        delete embedData.provider;

        const payload = {
            embeds: [new EmbedBuilder(embedData)],
            IsComponentsV2: true
        };

        if (newMessage.components && newMessage.components.length > 0) {
            payload.components = newMessage.components;
        }

        extraPayloads.push(payload);
    }

    if (oldMessage.embeds && oldMessage.embeds.length > 0 && !isUserMessage) {
        for (let i = 0; i < oldMessage.embeds.length; i++) {
            const msgEmbed = oldMessage.embeds[i];
            const embedData = reconstructEmbed(msgEmbed);
            const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(embedData, null, 2)), {
                name: `old_embed_${i + 1}.json`
            });
            files.push(attachment);
        }
    }

    if ((oldMessage.components && oldMessage.components.length > 0) || (newMessage.components && newMessage.components.length > 0)) {
        if (oldMessage.components && oldMessage.components.length > 0) {
            const oldComponentsData = oldMessage.components.map(c => c.toJSON());
            const jsonString = JSON.stringify(oldComponentsData, null, 2);
            if (jsonString.length < 1000) {
                embed.addFields({ name: t('modlog:component_changes') + ' (Old)', value: `\`\`\`json\n${jsonString}\n\`\`\`` });
            } else {
                const attachment = new AttachmentBuilder(Buffer.from(jsonString), {
                    name: 'old_components.json'
                });
                files.push(attachment);
            }
        }
        if (newMessage.components && newMessage.components.length > 0 && extraPayloads.length === 0) {
            const newComponentsData = newMessage.components.map(c => c.toJSON());
            const jsonString = JSON.stringify(newComponentsData, null, 2);
            if (jsonString.length < 1000) {
                embed.addFields({ name: t('modlog:component_changes') + ' (New)', value: `\`\`\`json\n${jsonString}\n\`\`\`` });
            } else {
                const attachment = new AttachmentBuilder(Buffer.from(jsonString), {
                    name: 'new_components.json'
                });
                files.push(attachment);
            }
        }
    }

    return { embed: embedsToSend[0], embeds: embedsToSend, files, extraPayloads };
}

function reconstructEmbed(msgEmbed) {
    const embedData = {
        type: msgEmbed.data.type || 'rich',
        title: msgEmbed.data.title,
        description: msgEmbed.data.description,
        url: msgEmbed.data.url,
        timestamp: msgEmbed.data.timestamp,
        color: msgEmbed.data.color,
        footer: msgEmbed.data.footer,
        image: msgEmbed.data.image,
        thumbnail: msgEmbed.data.thumbnail,
        video: msgEmbed.data.video,
        provider: msgEmbed.data.provider,
        author: msgEmbed.data.author,
        fields: msgEmbed.data.fields
    };

    if (msgEmbed.data.flags || msgEmbed.data.components) {
        embedData._componentsV2 = true;
        embedData.flags = msgEmbed.data.flags;
        embedData.components = msgEmbed.data.components;
    }

    Object.keys(embedData).forEach(key => embedData[key] === undefined && delete embedData[key]);

    return embedData;
}

function buildMemberJoinEmbed(data, bot, t) {
    const { member } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.join} ${t('modlog:member_joined')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields(
        { name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true },
        { name: t('modlog:account_created'), value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
    );

    return embed;
}

function buildMemberLeaveEmbed(data, bot, t) {
    const { member, user } = data;
    const targetUser = member?.user || user;

    const embed = new EmbedBuilder()
        .setColor(0xFF9999)
        .setTitle(`${WE.leave} ${t('modlog:member_left')}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${targetUser.tag} (${targetUser.id})`, inline: true });

    if (member?.joinedTimestamp) {
        embed.addFields({ name: t('modlog:joined'), value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
    }

    if (member?.roles?.cache) {
        const roles = member.roles.cache
            .filter(role => role.id !== member.guild.id)
            .map(role => role.name)
            .join(', ');
        if (roles) {
            embed.addFields({ name: t('modlog:roles'), value: roles.substring(0, 1024) });
        }
    }

    return embed;
}

function buildMemberBanEmbed(data, bot, t) {
    const { user, reason, moderator, member } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF4757)
        .setTitle(`${WE.ban} ${t('modlog:member_banned')}`)
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${user.tag} (${user.id})`, inline: true });

    if (member?.joinedTimestamp) {
        embed.addFields({ name: t('modlog:joined'), value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
    }

    if (moderator) {
        embed.addFields({ name: t('modlog:banned_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (reason) {
        embed.addFields({ name: t('modlog:reason'), value: reason });
    }

    return embed;
}

function buildMemberUnbanEmbed(data, bot, t) {
    const { user, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:member_unbanned')}`)
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${user.tag} (${user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:unbanned_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

async function buildBulkMessageDeleteEmbed(data, bot, t) {
    const { count, channel, messages, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:messages_deleted_bulk') || 'Bulk Messages Deleted'}`)
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({
        name: t('modlog:count') || 'Count',
        value: `${count} messages`,
        inline: true
    });

    embed.addFields({
        name: t('modlog:channel'),
        value: `<#${channel.id}>`,
        inline: true
    });

    if (moderator) {
        embed.addFields({
            name: t('modlog:moderator'),
            value: `${moderator.tag} (${moderator.id})`,
            inline: true
        });
    }

    const userCounts = new Map();
    const oldestMessage = messages.reduce((oldest, msg) =>
        msg.createdTimestamp < oldest.createdTimestamp ? msg : oldest, messages.first()
    );
    const newestMessage = messages.reduce((newest, msg) =>
        msg.createdTimestamp > newest.createdTimestamp ? msg : newest, messages.first()
    );

    messages.forEach(msg => {
        if (msg.author) {
            const userId = msg.author.id;
            userCounts.set(userId, (userCounts.get(userId) || 0) + 1);
        }
    });

    const description = [];
    description.push(`**${count} messages** were bulk deleted from ${channel}`);

    if (userCounts.size > 0) {
        description.push(`**Affected users:** ${userCounts.size} user${userCounts.size > 1 ? 's' : ''}`);
    }

    /* const timeRange = newestMessage.createdTimestamp - oldestMessage.createdTimestamp;
    if (timeRange > 0) {
        const minutes = Math.floor(timeRange / (1000 * 60));
        const seconds = Math.floor((timeRange % (1000 * 60)) / 1000);
        description.push(`**Time range:** ${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`);
    } */

    embed.setDescription(description.join('\n'));

    if (messages.size > 0) {
        const sampleLines = [];
        const sampleMessages = messages.first(5);

        sampleMessages.forEach((msg, index) => {
            if (index < 3) {
                const author = msg.author?.tag || 'Unknown';
                const content = msg.content ?
                    (msg.content.length > 50 ? msg.content.substring(0, 47) + '...' : msg.content) :
                    '[No text content]';
                sampleLines.push(`• **${author}**: ${content}`);
            }
        });

        if (messages.size > 3) {
            sampleLines.push(`• ...and ${messages.size - 3} more messages`);
        }

        if (sampleLines.length > 0) {
            embed.addFields({
                name: t('modlog:sample') || 'Sample',
                value: sampleLines.join('\n'),
                inline: false
            });
        }
    }

    return { embed };
}

function buildMemberKickEmbed(data, bot, t) {
    const { user, member, reason, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFFA502)
        .setTitle(`${WE.leave} ${t('modlog:member_kicked')}`)
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${user.tag} (${user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:kicked_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (member?.joinedTimestamp) {
        embed.addFields({ name: t('modlog:joined'), value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
    }

    if (reason) {
        embed.addFields({ name: t('modlog:reason'), value: reason });
    }

    return embed;
}

function buildMemberTimeoutEmbed(data, bot, t) {
    const { member, until, reason, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFFD93D)
        .setTitle(`${WE.locked} ${t('modlog:member_timed_out')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:timed_out_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (until) {
        embed.addFields({ name: t('modlog:until'), value: `<t:${Math.floor(until.getTime() / 1000)}:F>`, inline: true });
    }

    if (reason) {
        embed.addFields({ name: t('modlog:reason'), value: reason });
    }

    return embed;
}

function buildMemberTimeoutRemoveEmbed(data, bot, t) {
    const { member, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:timeout_removed')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:removed_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildChannelCreateEmbed(data, t) {
    const { channel, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:channel_created')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    const icon = getChannelIcon(channel.type);
    embed.addFields({ name: t('modlog:channel'), value: `${icon} <#${channel.id}>`, inline: true });
    embed.addFields({ name: t('modlog:channel_id'), value: channel.id, inline: true });
    embed.addFields({ name: t('modlog:channel_name'), value: channel.name, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:created_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildChannelUpdateEmbed(data, t) {
    const { oldChannel, newChannel, changes, moderator } = data;

    const icon = getChannelIcon(newChannel.type);
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${icon} ${t('modlog:channel_updated')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:channel'), value: `<#${newChannel.id}>`, inline: true });
    embed.addFields({ name: t('modlog:channel_id'), value: newChannel.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:modified_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    /* if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        embed.addFields({ name: t('modlog:slowmode'), value: `${oldChannel.rateLimitPerUser}s ➔ ${newChannel.rateLimitPerUser}s`, inline: true });
    } */

    const permChanges = getPermissionChanges(oldChannel, newChannel, t);
    if (permChanges.length > 0) {
        const permString = permChanges.join('\n');
        if (permString.length > 1024) {
            embed.addFields({ name: t('modlog:permissions_updated'), value: permString.substring(0, 1021) + '...' });
        } else {
            embed.addFields({ name: t('modlog:permissions_updated'), value: permString });
        }
    }

    if (changes && changes.length > 0) {
        const changeList = changes.map(c => {
            let fieldName = c.field;
            if (fieldName === 'Bitrate') fieldName = t('modlog:voice_bitrate');
            if (fieldName === 'User Limit') fieldName = t('modlog:voice_user_limit');
            if (fieldName === 'Region') fieldName = t('modlog:voice_region');
            if (fieldName === 'Video Quality') fieldName = t('modlog:voice_video_quality');
            const formatVal = (v) => (v === undefined || v === null || v === '') ? (t('modlog:none') || 'None') : v;
            return `**${fieldName}**: ${formatVal(c.old)} → ${formatVal(c.new)}`;
        }).join('\n');
        embed.addFields({ name: t('modlog:changes'), value: changeList.substring(0, 1024) });
    }

    return embed;
}

function buildChannelDeleteEmbed(data, t) {
    const { channel, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:channel_deleted')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:channel_name'), value: channel.name, inline: true });
    embed.addFields({ name: t('modlog:channel_id'), value: channel.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:deleted_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildEmojiCreateEmbed(data, t) {
    const { emoji, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:emoji_created')}`)
        .setThumbnail(emoji.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:emoji'), value: `${emoji} \`${emoji.name}\``, inline: true });
    embed.addFields({ name: t('modlog:id'), value: emoji.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:created_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildEmojiDeleteEmbed(data, t) {
    const { emoji, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:emoji_deleted')}`)
        .setThumbnail(emoji.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:emoji_name'), value: emoji.name, inline: true });
    embed.addFields({ name: t('modlog:id'), value: emoji.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:deleted_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildEmojiUpdateEmbed(data, t) {
    const { oldEmoji, newEmoji, changes, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.settings} ${t('modlog:emoji_updated')}`)
        .setThumbnail(newEmoji.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:emoji'), value: `${newEmoji} \`${newEmoji.name}\``, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:modified_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (changes && changes.length > 0) {
        const formatVal = (v) => (v === undefined || v === null || v === '') ? (t('modlog:none') || 'None') : v;
        const changeList = changes.map(c => `**${c.field}**: ${formatVal(c.old)} → ${formatVal(c.new)}`).join('\n');
        embed.addFields({ name: t('modlog:changes'), value: changeList.substring(0, 1024) });
    }

    return embed;
}

function buildInviteCreateEmbed(data, t) {
    const { invite } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.invite} ${t('modlog:invite_created')}`)
        .setFooter({ text: "Waterfall", iconURL: invite.inviter?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:code'), value: invite.code, inline: true });
    embed.addFields({ name: t('modlog:channel'), value: `<#${invite.channel.id}>`, inline: true });

    if (invite.inviter) {
        embed.addFields({ name: t('modlog:created_by'), value: `${invite.inviter.tag} (${invite.inviter.id})`, inline: true });
    }

    if (invite.maxAge > 0) {
        embed.addFields({ name: t('modlog:expires'), value: `<t:${Math.floor((Date.now() + invite.maxAge * 1000) / 1000)}:R>`, inline: true });
    } else {
        embed.addFields({ name: t('modlog:expires'), value: t('modlog:never'), inline: true });
    }

    if (invite.maxUses > 0) {
        embed.addFields({ name: t('modlog:max_uses'), value: `${invite.maxUses}`, inline: true });
    }

    return embed;
}

function buildInviteDeleteEmbed(data, t) {
    const { invite } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:invite_deleted')}`)
        .setTimestamp();

    embed.addFields({ name: t('modlog:code'), value: invite.code, inline: true });
    embed.addFields({ name: t('modlog:channel'), value: `<#${invite.channel.id}>`, inline: true });

    return embed;
}

function buildMemberWarnEmbed(data, bot, t) {
    const { member, reason, moderator, warnCount, actionTaken } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFFC312)
        .setTitle(`${WE.warn} ${t('modlog:member_warned')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:warned_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (warnCount) {
        embed.addFields({ name: t('modlog:warn_count'), value: `${warnCount}`, inline: true });
    }

    if (reason) {
        embed.addFields({ name: t('modlog:reason'), value: reason });
    }

    if (actionTaken) {
        embed.addFields({
            name: t('modlog:action_triggered'),
            value: `${t('modlog:action_' + actionTaken.action)} (${formatDuration(actionTaken.duration)})`
        });
    }

    return embed;
}

function buildMemberWarnRemoveEmbed(data, bot, t) {
    const { member, reason, moderator, warnCount } = data;

    const embed = new EmbedBuilder()
        .setColor(0x28a745)
        .setTitle(`${WE.settings} ${t('modlog:warn_removed')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:moderator'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    embed.addFields({ name: t('modlog:removed_reason'), value: reason });
    embed.addFields({ name: t('modlog:remaining_warns'), value: `${warnCount}`, inline: true });

    return embed;
}

function buildMemberWarnClearEmbed(data, bot, t) {
    const { member, moderator, clearedCount } = data;

    const embed = new EmbedBuilder()
        .setColor(0x28a745)
        .setTitle(`${WE.settings} ${t('modlog:warns_cleared')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:user'), value: `${member.user.tag} (${member.user.id})`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:moderator'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    embed.addFields({ name: t('modlog:cleared_count'), value: `${clearedCount}`, inline: true });

    return embed;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

function buildRoleCreateEmbed(data, t) {
    const { role, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:role_created')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:role'), value: `${role} (${role.name})`, inline: true });
    embed.addFields({ name: t('modlog:id'), value: role.id, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:created_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    return embed;
}

function buildRoleDeleteEmbed(data, t) {
    const { role, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:role_deleted')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:role_name'), value: role.name, inline: true });
    embed.addFields({ name: t('modlog:id'), value: role.id, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:deleted_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    return embed;
}

function buildRoleUpdateEmbed(data, t) {
    const { oldRole, newRole, changes, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.settings} ${t('modlog:role_updated')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:role'), value: `${newRole} (\`${newRole.id}\`)`, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:modified_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    if (changes && changes.length > 0) {
        const formatVal = (v) => (v === undefined || v === null || v === '') ? (t('modlog:none') || 'None') : v;
        const changeList = changes.map(c => `**${t('modlog:' + c.field.toLowerCase().replace(' ', '_')) || c.field}**: ${formatVal(c.old)} → ${formatVal(c.new)}`).join('\n');
        embed.addFields({ name: t('modlog:changes'), value: changeList.substring(0, 1024) });
    }

    if (!oldRole.permissions.equals(newRole.permissions)) {
        const added = newRole.permissions.remove(oldRole.permissions).toArray();
        const removed = oldRole.permissions.remove(newRole.permissions).toArray();

        const permChanges = [];
        if (added.length) permChanges.push(`✅ ${t('modlog:added')}: ${added.join(', ')}`);
        if (removed.length) permChanges.push(`❌ ${t('modlog:removed')}: ${removed.join(', ')}`);

        if (permChanges.length > 0) {
            embed.addFields({ name: t('modlog:permissions'), value: permChanges.join('\n') });
        }
    }

    return embed;
}

function buildMemberRoleAddEmbed(data, bot, t) {
    const { member, roles, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:member_roles_added')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:member'), value: `${member.user.tag} (${member.id})`, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:updated_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    const roleList = roles.map(r => r.toString()).join(', ');
    embed.addFields({ name: t('modlog:roles_added'), value: roleList });

    return embed;
}

function buildMemberRoleRemoveEmbed(data, bot, t) {
    const { member, roles, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:member_roles_removed')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:member'), value: `${member.user.tag} (${member.id})`, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:updated_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    const roleList = roles.map(r => r.toString()).join(', ');
    embed.addFields({ name: t('modlog:roles_removed'), value: roleList });

    return embed;
}

function buildMemberNicknameChangeEmbed(data, bot, t) {
    const { member, oldNickname, newNickname, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.settings} ${t('modlog:nickname_changed')}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:member'), value: `${member.user.tag} (${member.id})`, inline: true });
    if (moderator) embed.addFields({ name: t('modlog:updated_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });

    embed.addFields({ name: t('modlog:before'), value: oldNickname || t('modlog:none'), inline: false });
    embed.addFields({ name: t('modlog:after'), value: newNickname || t('modlog:none'), inline: false });

    return embed;
}

function buildStickerCreateEmbed(data, t) {
    const { sticker, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x6BCF7F)
        .setTitle(`${WE.add} ${t('modlog:sticker_created')}`)
        .setThumbnail(sticker.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:sticker'), value: `\`${sticker.name}\``, inline: true });
    embed.addFields({ name: t('modlog:id'), value: sticker.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:created_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildStickerDeleteEmbed(data, t) {
    const { sticker, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${t('modlog:sticker_deleted')}`)
        .setThumbnail(sticker.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: t('modlog:sticker'), value: sticker.name, inline: true });
    embed.addFields({ name: t('modlog:id'), value: sticker.id, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:deleted_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildStickerUpdateEmbed(data, t) {
    const { oldSticker, newSticker, moderator } = data;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.settings} Sticker Updated`)
        .setThumbnail(newSticker.url)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: 'Sticker', value: `${newSticker.name} (${newSticker.id})`, inline: true });
    if (moderator) embed.addFields({ name: 'Updated By', value: `${moderator.tag}`, inline: true });

    const formatVal = (v) => (v === undefined || v === null || v === '') ? (t('modlog:none') || 'None') : v;

    if (oldSticker.name !== newSticker.name) {
        embed.addFields({ name: 'Name', value: `${formatVal(oldSticker.name)} ➔ ${formatVal(newSticker.name)}`, inline: true });
    }
    if (oldSticker.description !== newSticker.description) {
        embed.addFields({ name: 'Description', value: `${formatVal(oldSticker.description)} ➔ ${formatVal(newSticker.description)}`, inline: true });
    }
    if (oldSticker.tags !== newSticker.tags) {
        embed.addFields({ name: 'Emoji', value: `${formatVal(oldSticker.tags)} ➔ ${formatVal(newSticker.tags)}`, inline: true });
    }

    return embed;
}

function getChannelIcon(type) {
    // 0:GuildText, 2:GuildVoice, 4:GuildCategory, 5:GuildAnnouncement, 13:GuildStageVoice, 15:GuildForum
    switch (type) {
        case 0: return WE.channel;
        case 2: return WE.voice;
        case 5: return WE.channel;
        case 13: return WE.stage;
        case 15: return WE.forum;
        default: return WE.channel;
    }
}

function getColorForAction(action) {
    const colors = {
        'PURGE': 0xFF9999,
        'BAN': 0xFF4757,
        'KICK': 0xFFA502,
        'TIMEOUT': 0xFFD93D,
        'WARN': 0xFFC312
    };
    return colors[action] || 0x5865F2;
}

function getEmojiForAction(action) {
    const emojis = {
        'PURGE': WE.trash,
        'BAN': WE.ban,
        'KICK': WE.leave,
        'TIMEOUT': WE.locked,
        'WARN': WE.warn
    };
    return emojis[action] || WE.settings;
}

function getPermissionChanges(oldChannel, newChannel, t) {
    const changes = [];
    const oldPerms = oldChannel.permissionOverwrites.cache;
    const newPerms = newChannel.permissionOverwrites.cache;

    const formatPerms = (perms) => perms.map(p => t(`permissions:${p}`) || p).join(', ');

    newPerms.forEach((overwrite, id) => {
        const oldOverwrite = oldPerms.get(id);
        const target = overwrite.type === 0 ? `<@&${id}>` : `<@${id}>`; // 0 = Role  1 = Member

        if (!oldOverwrite) {
            changes.push(t('modlog:perm_added', { target }));
            const allowed = overwrite.allow.toArray();
            const denied = overwrite.deny.toArray();
            if (allowed.length) changes.push(`> ✅ ${formatPerms(allowed)}`);
            if (denied.length) changes.push(`> ❌ ${formatPerms(denied)}`);
        } else if (!oldOverwrite.allow.equals(overwrite.allow) || !oldOverwrite.deny.equals(overwrite.deny)) {
            changes.push(t('modlog:perm_modified', { target }));

            const oldAllow = oldOverwrite.allow;
            const newAllow = overwrite.allow;
            const oldDeny = oldOverwrite.deny;
            const newDeny = overwrite.deny;

            const addedAllow = newAllow.remove(oldAllow).toArray();
            const removedAllow = oldAllow.remove(newAllow).toArray();
            const addedDeny = newDeny.remove(oldDeny).toArray();
            const removedDeny = oldDeny.remove(newDeny).toArray();

            if (addedAllow.length) changes.push(`> ✅ ${t('modlog:allowed')}: ${formatPerms(addedAllow)}`);
            if (removedAllow.length) changes.push(`> ➖ ${t('modlog:unallowed')}: ${formatPerms(removedAllow)}`);
            if (addedDeny.length) changes.push(`> ❌ ${t('modlog:denied')}: ${formatPerms(addedDeny)}`);
            if (removedDeny.length) changes.push(`> ➖ ${t('modlog:undenied')}: ${formatPerms(removedDeny)}`);
        }
    });

    oldPerms.forEach((overwrite, id) => {
        if (!newPerms.has(id)) {
            const target = overwrite.type === 0 ? `<@&${id}>` : `<@${id}>`;
            changes.push(t('modlog:perm_removed', { target }));
        }
    });

    return changes;
}

function buildThreadDeleteEmbed(data, t) {
    const { thread, moderator } = data;
    const isForum = thread.parent?.type === ChannelType.GuildForum;

    const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(`${WE.trash} ${isForum ? (t('modlog:forum_post_deleted') || 'Forum Post Deleted') : (t('modlog:thread_deleted') || 'Thread Deleted')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: isForum ? (t('modlog:post_name') || 'Post Name') : (t('modlog:thread_name') || 'Thread Name'), value: thread.name, inline: true });
    embed.addFields({ name: t('modlog:id'), value: thread.id, inline: true });

    if (thread.parent) {
        embed.addFields({ name: t('modlog:parent_channel') || 'Parent Channel', value: `<#${thread.parent.id}>`, inline: true });
    }

    if (moderator) {
        embed.addFields({ name: t('modlog:deleted_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    return embed;
}

function buildThreadUpdateEmbed(data, t) {
    const { newThread, changes, moderator } = data;
    const isForum = newThread.parent?.type === ChannelType.GuildForum;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.forum} ${isForum ? (t('modlog:forum_post_updated') || 'Forum Post Updated') : (t('modlog:thread_updated') || 'Thread Updated')}`)
        .setFooter({ text: "Waterfall", iconURL: moderator?.displayAvatarURL() })
        .setTimestamp();

    embed.addFields({ name: isForum ? (t('modlog:post') || 'Post') : (t('modlog:thread') || 'Thread'), value: `<#${newThread.id}>`, inline: true });

    if (moderator) {
        embed.addFields({ name: t('modlog:updated_by'), value: `${moderator.tag} (${moderator.id})`, inline: true });
    }

    if (changes && changes.length > 0) {
        const changeList = changes.map(c => {
            let fieldName = c.field;
            if (fieldName === 'name') fieldName = t('modlog:name') || 'Name';
            if (fieldName === 'archived') fieldName = t('modlog:thread_archived') || 'Archived';
            if (fieldName === 'locked') fieldName = t('modlog:thread_locked') || 'Locked';
            if (fieldName === 'slowmode') fieldName = t('modlog:thread_slowmode') || 'Slowmode';
            if (fieldName === 'auto_archive') fieldName = t('modlog:thread_auto_archive') || 'Auto Archive';
            if (fieldName === 'tags') fieldName = t('modlog:thread_tags') || 'Tags';

            const formatVal = (v) => (v === undefined || v === null || v === '') ? (t('modlog:none') || 'None') : v;
            return `**${fieldName}**: ${formatVal(c.old)} ➔ ${formatVal(c.new)}`;
        }).join('\n');
        embed.addFields({ name: t('modlog:changes'), value: changeList.substring(0, 1024) });
    }

    return embed;
}

function buildChannelHierarchyEmbed(data, bot, t) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.channel} ${t('modlog:hierarchy_updated')}`)
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    if (data.mover) {
        let moverDesc = `${t('modlog:item_moved', { item: `<#${data.mover.id}>` })}\n`;
        moverDesc += `${t('modlog:position_change', { old: data.mover.oldPos, new: data.mover.newPos })}\n`;

        if (data.mover.neighborAbove && data.mover.neighborBelow) {
            moverDesc += `📍 ${t('modlog:placed_between', { above: `<#${data.mover.neighborAbove.id}>`, below: `<#${data.mover.neighborBelow.id}>` })}`;
        } else if (data.mover.neighborAbove) {
            moverDesc += `⬇️ ${t('modlog:placed_below', { target: `<#${data.mover.neighborAbove.id}>` })}`;
        } else if (data.mover.neighborBelow) {
            moverDesc += `⬆️ ${t('modlog:placed_above', { target: `<#${data.mover.neighborBelow.id}>` })}`;
        }

        embed.addFields({ name: t('modlog:primary_change'), value: moverDesc });
    } else if (data.changes && Array.isArray(data.changes)) {
        const value = data.changes.join('\n');
        embed.addFields({
            name: t('modlog:position_changes', { count: data.count }),
            value: value.length > 1024 ? value.substring(0, 1021) + '...' : value
        });
    } else {
        embed.addFields({
            name: t('modlog:position_changes', { count: data.count }),
            value: t('modlog:multiple_items_shifted') || "Multiple items shifted"
        });
    }

    if (data.moderator) {
        embed.addFields({ name: t('modlog:modified_by'), value: `${data.moderator.tag} (${data.moderator.id})`, inline: true });
    }

    return embed;
}

function buildRoleHierarchyEmbed(data, bot, t) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${WE.role} ${t('modlog:hierarchy_updated')}`)
        .setFooter({ text: "Waterfall", iconURL: bot.user.displayAvatarURL() })
        .setTimestamp();

    if (data.mover) {
        let moverDesc = `${t('modlog:item_moved', { item: `<@&${data.mover.id}>` })}\n`;
        moverDesc += `${t('modlog:position_change', { old: data.mover.oldPos, new: data.mover.newPos })}\n`;

        if (data.mover.neighborAbove && data.mover.neighborBelow) {
            moverDesc += `📍 ${t('modlog:placed_between', { above: `<@&${data.mover.neighborAbove.id}>`, below: `<@&${data.mover.neighborBelow.id}>` })}`;
        } else if (data.mover.neighborAbove) {
            moverDesc += `⬇️ ${t('modlog:placed_below', { target: `<@&${data.mover.neighborAbove.id}>` })}`;
        } else if (data.mover.neighborBelow) {
            moverDesc += `⬆️ ${t('modlog:placed_above', { target: `<@&${data.mover.neighborBelow.id}>` })}`;
        }

        embed.addFields({ name: t('modlog:primary_change'), value: moverDesc });
    } else if (data.changes && Array.isArray(data.changes)) {
        const value = data.changes.join('\n');
        embed.addFields({
            name: t('modlog:position_changes', { count: data.count }),
            value: value.length > 1024 ? value.substring(0, 1021) + '...' : value
        });
    } else {
        embed.addFields({
            name: t('modlog:position_changes', { count: data.count }),
            value: t('modlog:multiple_items_shifted') || "Multiple items shifted"
        });
    }

    if (data.moderator) {
        embed.addFields({ name: t('modlog:modified_by'), value: `${data.moderator.tag} (${data.moderator.id})`, inline: true });
    }

    return embed;
}
//
module.exports = {
    logAction,
    logEvent
};
