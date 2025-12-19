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
                batch.changes.push(`**@${newRole.name}**: ${oldRole.rawPosition} ➔ ${newRole.rawPosition}`);
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

    batch.changes = [...new Set(batch.changes)].sort();

    if (batch.changes.length === 0) return;

    let moderator = null;
    let auditLogPermissionsMissing = false;

    try {
        const guild = await bot.guilds.fetch(guildId);
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            auditLogPermissionsMissing = true;
        } else {
            try {
                const auditLogs = await guild.fetchAuditLogs({
                    type: AuditLogEvent.RoleUpdate,
                    limit: 1
                });
                const updateLog = auditLogs.entries.first();
                if (updateLog) {
                    moderator = updateLog.executor;
                }
            } catch (err) {
                if (err.code === 50013) {
                    auditLogPermissionsMissing = true;
                }
            }
        }
    } catch (err) {
        //
    }

    await modLog.logEvent(bot, guildId, 'roleHierarchyUpdate', {
        count: batch.changes.length,
        changes: batch.changes,
        moderator: moderator,
        auditLogPermissionsMissing: auditLogPermissionsMissing
    }, `hierarchy:${JSON.stringify(batch.changes)}`);
}
