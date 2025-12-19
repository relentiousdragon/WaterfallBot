const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.ThreadUpdate,
    async execute(bot, oldThread, newThread) {
        try {
            if (!newThread.guild) return;

            const changes = [];

            if (oldThread.name !== newThread.name) {
                changes.push({
                    field: 'name',
                    old: oldThread.name,
                    new: newThread.name
                });
            }

            if (oldThread.archived !== newThread.archived) {
                changes.push({
                    field: 'archived',
                    old: oldThread.archived,
                    new: newThread.archived
                });
            }

            if (oldThread.locked !== newThread.locked) {
                changes.push({
                    field: 'locked',
                    old: oldThread.locked,
                    new: newThread.locked
                });
            }

            if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) {
                changes.push({
                    field: 'slowmode',
                    old: oldThread.rateLimitPerUser,
                    new: newThread.rateLimitPerUser
                });
            }

            if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) {
                changes.push({
                    field: 'auto_archive',
                    old: oldThread.autoArchiveDuration,
                    new: newThread.autoArchiveDuration
                });
            }

            if (oldThread.appliedTags.length !== newThread.appliedTags.length ||
                !oldThread.appliedTags.every(t => newThread.appliedTags.includes(t))) {

                const formatTags = (tags) => {
                    if (!tags || tags.length === 0) return 'None';
                    const parent = newThread.parent;
                    if (!parent) return tags.join(', ');

                    return tags.map(tagId => {
                        const tag = parent.availableTags.find(t => t.id === tagId);
                        return tag ? tag.name : tagId;
                    }).join(', ');
                };

                changes.push({
                    field: 'tags',
                    old: formatTags(oldThread.appliedTags),
                    new: formatTags(newThread.appliedTags)
                });
            }

            if (changes.length === 0) return;

            let moderator = null;
            let auditLogPermissionsMissing = false;

            if (!newThread.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                auditLogPermissionsMissing = true;
            } else {
                try {
                    const auditLogs = await newThread.guild.fetchAuditLogs({
                        type: AuditLogEvent.ThreadUpdate,
                        limit: 1
                    });

                    const log = auditLogs.entries.first();
                    if (log && log.target.id === newThread.id && (Date.now() - log.createdTimestamp < 15000)) {
                        moderator = log.executor;
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        auditLogPermissionsMissing = true;
                    }
                }
            }

            await modLog.logEvent(bot, newThread.guild.id, 'threadUpdate', {
                oldThread: oldThread,
                newThread: newThread,
                changes: changes,
                moderator: moderator,
                auditLogPermissionsMissing: auditLogPermissionsMissing
            });

        } catch (error) {
            if (settings.debug === 'true') {
                logger.error(`Error logging thread update event: ${error.message}`, error);
            }
        }
    }
};
