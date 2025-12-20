const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');

const pendingUpdates = new Map();
const BATCH_TIMEOUT = 2000;
//
module.exports = {
    name: Events.ChannelUpdate,
    async execute(bot, oldChannel, newChannel) {
        try {
            const changes = [];

            if (oldChannel.name !== newChannel.name) {
                changes.push({
                    field: 'Name',
                    old: oldChannel.name,
                    new: newChannel.name
                });
            }

            const oldTopic = oldChannel.topic || '';
            const newTopic = newChannel.topic || '';
            if (oldTopic !== newTopic) {
                changes.push({
                    field: 'Topic',
                    old: oldTopic || 'None',
                    new: newTopic || 'None'
                });
            }

            if (oldChannel.nsfw !== newChannel.nsfw) {
                changes.push({
                    field: 'NSFW',
                    old: oldChannel.nsfw ? 'Yes' : 'No',
                    new: newChannel.nsfw ? 'Yes' : 'No'
                });
            }

            if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
                changes.push({
                    field: 'Slowmode',
                    old: `${oldChannel.rateLimitPerUser}s`,
                    new: `${newChannel.rateLimitPerUser}s`
                });
            }

            let hasPermissionChanges = false;
            const oldPerms = oldChannel.permissionOverwrites?.cache;
            const newPerms = newChannel.permissionOverwrites?.cache;

            if (oldPerms && newPerms) {
                const oldIds = [...oldPerms.keys()].sort();
                const newIds = [...newPerms.keys()].sort();

                if (oldIds.length !== newIds.length || oldIds.some((id, i) => id !== newIds[i])) {
                    hasPermissionChanges = true;
                } else {
                    for (const id of oldIds) {
                        const oldPerm = oldPerms.get(id);
                        const newPerm = newPerms.get(id);
                        if (oldPerm.allow.bitfield !== newPerm.allow.bitfield ||
                            oldPerm.deny.bitfield !== newPerm.deny.bitfield) {
                            hasPermissionChanges = true;
                            break;
                        }
                    }
                }
            } else if (oldPerms || newPerms) {
                hasPermissionChanges = true;
            }

            if (oldChannel.bitrate !== newChannel.bitrate) {
                changes.push({
                    field: 'Bitrate',
                    old: `${oldChannel.bitrate / 1000}kbps`,
                    new: `${newChannel.bitrate / 1000}kbps`
                });
            }

            if (oldChannel.userLimit !== newChannel.userLimit) {
                changes.push({
                    field: 'User Limit',
                    old: `${oldChannel.userLimit}`,
                    new: `${newChannel.userLimit}`
                });
            }

            if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
                changes.push({
                    field: 'Region',
                    old: oldChannel.rtcRegion || 'Automatic',
                    new: newChannel.rtcRegion || 'Automatic'
                });
            }

            if (oldChannel.videoQualityMode !== newChannel.videoQualityMode) {
                changes.push({
                    field: 'Video Quality',
                    old: oldChannel.videoQualityMode === 1 ? 'Auto' : 'Full',
                    new: newChannel.videoQualityMode === 1 ? 'Auto' : 'Full'
                });
            }

            const positionChanged = oldChannel.rawPosition !== newChannel.rawPosition;
            const parentChanged = oldChannel.parentId !== newChannel.parentId;

            if (changes.length === 0 && !hasPermissionChanges && (positionChanged || parentChanged)) {
                const guildId = newChannel.guild.id;

                if (!pendingUpdates.has(guildId)) {
                    pendingUpdates.set(guildId, {
                        changes: [],
                        timeout: setTimeout(() => flushUpdates(bot, guildId), BATCH_TIMEOUT)
                    });
                }

                const batch = pendingUpdates.get(guildId);
                batch.changes.push({
                    id: newChannel.id,
                    name: newChannel.name,
                    oldPos: oldChannel.rawPosition,
                    newPos: newChannel.rawPosition,
                    oldParent: oldChannel.parentId,
                    newParent: newChannel.parentId,
                    channel: newChannel
                });
                return;
            }

            if (changes.length === 0 && !hasPermissionChanges) return;

            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!newChannel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await newChannel.guild.fetchAuditLogs({
                        type: AuditLogEvent.ChannelUpdate,
                        limit: 1
                    });

                    const updateLog = auditLogs.entries.first();
                    if (updateLog && updateLog.target.id === newChannel.id) {
                        moderator = updateLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, newChannel.guild.id, 'channelUpdate', {
                oldChannel: oldChannel,
                newChannel: newChannel,
                changes: changes,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging channel update event: ${error.message}`, error);
            }
        }
    }
};

async function flushUpdates(bot, guildId) {
    if (!pendingUpdates.has(guildId)) return;

    const batch = pendingUpdates.get(guildId);
    pendingUpdates.delete(guildId);

    if (batch.changes.length === 0) return;

    const uniqueChanges = new Map();
    for (const change of batch.changes) {
        uniqueChanges.set(change.id, change);
    }
    const changes = Array.from(uniqueChanges.values());

    if (changes.length > 15) return;
    if (changes.length === 0) return;

    let moderator = null;
    let auditLogPermissionsMissing = false;
    let mover = null;

    try {
        const guild = await bot.guilds.fetch(guildId);
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            auditLogPermissionsMissing = true;
        } else {
            try {
                const auditLogs = await guild.fetchAuditLogs({
                    type: AuditLogEvent.ChannelUpdate,
                    limit: 5
                });

                const updateLog = auditLogs.entries.find(entry =>
                    (Date.now() - entry.createdTimestamp) < 10000 &&
                    changes.some(c => c.id === entry.target.id)
                );

                if (updateLog) {
                    moderator = updateLog.executor;
                    mover = changes.find(c => c.id === updateLog.target.id);
                } else {
                    const firstLog = auditLogs.entries.first();
                    if (firstLog && (Date.now() - firstLog.createdTimestamp) < 10000) {
                        moderator = firstLog.executor;
                    }
                }
            } catch (err) {
                if (err.code === 50013) auditLogPermissionsMissing = true;
            }
        }

        if (!mover) {
            let maxDisplacement = -1;
            for (const change of changes) {
                const displacement = Math.abs(change.newPos - change.oldPos);
                if (displacement > maxDisplacement) {
                    maxDisplacement = displacement;
                    mover = change;
                }
            }
        }

        if (mover && mover.channel) {
            const parentId = mover.channel.parentId;
            const siblings = Array.from(guild.channels.cache.values())
                .filter(c => c.parentId === parentId)
                .sort((a, b) => b.rawPosition - a.rawPosition);

            const moverIndex = siblings.findIndex(c => c.id === mover.id);
            if (moverIndex !== -1) {
                if (moverIndex > 0) {
                    mover.neighborAbove = { id: siblings[moverIndex - 1].id, name: siblings[moverIndex - 1].name };
                }
                if (moverIndex < siblings.length - 1) {
                    mover.neighborBelow = { id: siblings[moverIndex + 1].id, name: siblings[moverIndex + 1].name };
                }
            }
        }
    } catch (err) {
        //
    }

    await modLog.logEvent(bot, guildId, 'channelHierarchyUpdate', {
        count: changes.length,
        mover: mover,
        moderator: null, //moderator,
        auditLogPermissionsMissing: auditLogPermissionsMissing
    }, `hierarchy:channels:${guildId}:${mover?.id || 'unknown'}`);
}
