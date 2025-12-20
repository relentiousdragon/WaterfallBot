const modLog = require("../util/modLog.js");
const logger = require("../logger.js");
const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");

const pendingUpdates = new Map();
const BATCH_TIMEOUT = 2000;
//
module.exports = {
    name: "roleUpdate",
    async execute(bot, oldRole, newRole) {
        try {
            const positionChanged = oldRole.rawPosition !== newRole.rawPosition;
            const otherChanges = oldRole.name !== newRole.name ||
                oldRole.color !== newRole.color ||
                oldRole.hoist !== newRole.hoist ||
                oldRole.mentionable !== newRole.mentionable ||
                oldRole.permissions.bitfield !== newRole.permissions.bitfield ||
                oldRole.icon !== newRole.icon;

            if (positionChanged && !otherChanges) {
                const guildId = newRole.guild.id;

                if (!pendingUpdates.has(guildId)) {
                    pendingUpdates.set(guildId, {
                        changes: [],
                        timeout: setTimeout(() => flushUpdates(bot, guildId), BATCH_TIMEOUT)
                    });
                }

                const batch = pendingUpdates.get(guildId);
                batch.changes.push({
                    id: newRole.id,
                    name: newRole.name,
                    oldPos: oldRole.rawPosition,
                    newPos: newRole.rawPosition,
                    role: newRole
                });
                return;
            }

            const changes = [];
            if (oldRole.name !== newRole.name) changes.push({ field: 'name', old: oldRole.name, new: newRole.name });
            if (oldRole.color !== newRole.color) changes.push({ field: 'color', old: oldRole.hexColor, new: newRole.hexColor });
            if (oldRole.hoist !== newRole.hoist) changes.push({ field: 'hoist', old: oldRole.hoist, new: newRole.hoist });
            if (oldRole.mentionable !== newRole.mentionable) changes.push({ field: 'mentionable', old: oldRole.mentionable, new: newRole.mentionable });
            if (oldRole.icon !== newRole.icon) changes.push({ field: 'icon', old: !!oldRole.icon, new: !!newRole.icon });

            if (changes.length === 0 && oldRole.permissions.bitfield === newRole.permissions.bitfield && !positionChanged) return;

            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!newRole.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const fetchedLogs = await newRole.guild.fetchAuditLogs({
                        limit: 1,
                        type: AuditLogEvent.RoleUpdate
                    });
                    const roleLog = fetchedLogs.entries.first();
                    if (roleLog && roleLog.target.id === newRole.id && (Date.now() - roleLog.createdTimestamp) < 5000) {
                        moderator = roleLog.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, newRole.guild.id, 'roleUpdate', {
                oldRole: oldRole,
                newRole: newRole,
                changes: changes,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });
        } catch (error) {
            if (process.env.DEBUG === 'true') {
                logger.error(`Error in roleUpdate event: ${error.message}`);
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
                    type: AuditLogEvent.RoleUpdate,
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

        if (mover) {
            const sortedRoles = Array.from(guild.roles.cache.values()).sort((a, b) => b.rawPosition - a.rawPosition);
            const moverIndex = sortedRoles.findIndex(r => r.id === mover.id);

            if (moverIndex !== -1) {
                if (moverIndex > 0) {
                    mover.neighborAbove = { id: sortedRoles[moverIndex - 1].id, name: sortedRoles[moverIndex - 1].name };
                }
                if (moverIndex < sortedRoles.length - 1) {
                    mover.neighborBelow = { id: sortedRoles[moverIndex + 1].id, name: sortedRoles[moverIndex + 1].name };
                }
            }
        }
    } catch (err) {
        logger.error(`Error in flushUpdates for roles: ${err.message}`);
    }

    await modLog.logEvent(bot, guildId, 'roleHierarchyUpdate', {
        count: changes.length,
        mover: mover,
        moderator: null, //moderator,
        auditLogPermissionsMissing: auditLogPermissionsMissing
    }, `hierarchy:roles:${guildId}:${mover?.id || 'unknown'}`);
}
