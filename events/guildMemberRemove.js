const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');

const processedUsers = new Map();
//
module.exports = {
    name: Events.GuildMemberRemove,
    async execute(bot, member) {
        try {
            const cacheKey = `${member.guild.id}:${member.id}`;
            const now = Date.now();

            if (processedUsers.has(cacheKey) && (now - processedUsers.get(cacheKey)) < 3000) {
                if (settings.debug === 'true') {
                    logger.debug(`[MemberRemove] Skipping already processed user ${member.id} in guild ${member.guild.id}`);
                }
                return;
            }

            processedUsers.set(cacheKey, now);

            setTimeout(() => {
                if (processedUsers.get(cacheKey) === now) {
                    processedUsers.delete(cacheKey);
                }
            }, 5000);

            await new Promise(res => setTimeout(res, 1500));

            let logType = 'memberLeave';
            let moderator = null;
            let reason = null;
            let auditLogPermissionsMissing = false;

            if (!member.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const [kickLogs, banLogs, pruneLogs] = await Promise.all([
                        member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 }),
                        member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 }),
                        member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberPrune, limit: 5 })
                    ]);

                    const now = Date.now();
                    const TEN_SECONDS = 10000;

                    const recentBan = banLogs.entries.find(entry =>
                        entry.target.id === member.id &&
                        (now - entry.createdTimestamp) < TEN_SECONDS
                    );

                    if (recentBan) {
                        logType = 'memberBan';
                        moderator = recentBan.executor;
                        reason = recentBan.reason || null;

                        if (settings.debug === 'true') {
                            logger.debug(`[MemberRemove] Detected ban for ${member.id} by ${moderator?.id || 'unknown'}`);
                        }
                    }
                    else {
                        const recentKick = kickLogs.entries.find(entry =>
                            entry.target.id === member.id &&
                            (now - entry.createdTimestamp) < TEN_SECONDS
                        );

                        if (recentKick) {
                            logType = 'memberKick';
                            moderator = recentKick.executor;
                            reason = recentKick.reason || null;

                            if (settings.debug === 'true') {
                                logger.debug(`[MemberRemove] Detected kick for ${member.id} by ${moderator?.id || 'unknown'}`);
                            }
                        }
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                    if (settings.debug === 'true') {
                        logger.debug(`[MemberRemove] Audit log fetch failed for ${member.guild.id}: ${err.message}`);
                    }
                }
            }
            const logData = {
                user: member.user,
                member: member,
                reason: reason,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            };

            if (settings.debug === 'true') {
                logger.debug(`[MemberRemove] Logging ${logType} for ${member.id} in ${member.guild.id}`);
            }

            await modLog.logEvent(bot, member.guild.id, logType, logData);

        } catch (error) {
            if (settings.debug === 'true' || settings.debug === true) {
                logger.error(`Error logging member remove event: ${error.message}`, error);
            }
        }
    }
};