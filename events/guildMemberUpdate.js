const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(bot, oldMember, newMember) {
        try {
            const guild = newMember.guild;
            let auditLogPermissionsMissing = !guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog);

            if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
                let moderator = null;
                let reason = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.MemberUpdate,
                            limit: 5
                        });

                        const timeoutLog = auditLogs.entries.find(entry =>
                            entry.target.id === newMember.id &&
                            entry.changes?.some(c => c.key === 'communication_disabled_until') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (timeoutLog) {
                            moderator = timeoutLog.executor;
                            reason = timeoutLog.reason;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                if (newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > Date.now()) {
                    await modLog.logEvent(bot, guild.id, 'memberTimeout', {
                        member: newMember,
                        until: newMember.communicationDisabledUntil,
                        moderator: moderator,
                        reason: reason,
                        auditLogPermissionsMissing: auditLogPermissionsMissing
                    });
                }
                else if (oldMember.communicationDisabledUntil && (!newMember.communicationDisabledUntil || newMember.communicationDisabledUntil <= Date.now())) {
                    await modLog.logEvent(bot, guild.id, 'memberTimeoutRemove', {
                        member: newMember,
                        moderator: moderator,
                        auditLogPermissionsMissing: auditLogPermissionsMissing
                    });
                }
            }

            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            if (!oldRoles.equals(newRoles)) {
                const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
                if (addedRoles.size > 0) {
                    let moderator = null;
                    let hasAuditLog = false;

                    if (!auditLogPermissionsMissing) {
                        try {
                            const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 });
                            const log = auditLogs.entries.first();
                            if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp) < 5000) {
                                moderator = log.executor;
                                hasAuditLog = true;
                            }
                        } catch (err) {
                            if (err.code === 50013) auditLogPermissionsMissing = true;
                        }
                    }

                    if (hasAuditLog || auditLogPermissionsMissing) {
                        await modLog.logEvent(bot, guild.id, 'memberRoleAdd', {
                            member: newMember,
                            roles: addedRoles,
                            moderator: moderator,
                            auditLogPermissionsMissing: auditLogPermissionsMissing
                        });
                    }
                }

                const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
                if (removedRoles.size > 0) {
                    let moderator = null;
                    let hasAuditLog = false;

                    if (!auditLogPermissionsMissing) {
                        try {
                            const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 });
                            const log = auditLogs.entries.first();
                            if (log && log.target.id === newMember.id && (Date.now() - log.createdTimestamp) < 5000) {
                                moderator = log.executor;
                                hasAuditLog = true;
                            }
                        } catch (err) {
                            if (err.code === 50013) auditLogPermissionsMissing = true;
                        }
                    }

                    if (hasAuditLog || auditLogPermissionsMissing) {
                        await modLog.logEvent(bot, guild.id, 'memberRoleRemove', {
                            member: newMember,
                            roles: removedRoles,
                            moderator: moderator,
                            auditLogPermissionsMissing: auditLogPermissionsMissing
                        });
                    }
                }
            }

            if (oldMember.nickname !== newMember.nickname) {
                let moderator = null;
                let hasAuditLog = false;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 1 });
                        const log = auditLogs.entries.first();
                        if (log && log.target.id === newMember.id && log.changes.some(c => c.key === 'nick') && (Date.now() - log.createdTimestamp) < 5000) {
                            moderator = log.executor;
                            hasAuditLog = true;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                if (hasAuditLog || auditLogPermissionsMissing || (oldMember.nickname && newMember.nickname)) {
                    await modLog.logEvent(bot, guild.id, 'memberNicknameChange', {
                        member: newMember,
                        oldNickname: oldMember.nickname,
                        newNickname: newMember.nickname,
                        moderator: moderator,
                        auditLogPermissionsMissing: auditLogPermissionsMissing
                    });
                }
            }
        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging timeout event: ${error.message}`, error)
            }
        }
    }
};


