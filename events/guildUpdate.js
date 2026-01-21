const { Events, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const modLog = require('../util/modLog.js');
const logger = require('../logger.js');
const { settings } = require('../util/settingsModule.js');
//
module.exports = {
    name: Events.GuildUpdate,
    async execute(bot, oldGuild, newGuild) {
        try {
            const guild = newGuild;
            let auditLogPermissionsMissing = !guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog);

            if (oldGuild.icon !== newGuild.icon) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const iconLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'icon') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (iconLog) {
                            moderator = iconLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildIconUpdate', {
                    oldIconURL: oldGuild.iconURL(),
                    newIconURL: newGuild.iconURL(),
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.banner !== newGuild.banner) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const bannerLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'banner') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (bannerLog) {
                            moderator = bannerLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildBannerUpdate', {
                    oldBannerURL: oldGuild.bannerURL(),
                    newBannerURL: newGuild.bannerURL(),
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.name !== newGuild.name) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const nameLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'name') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (nameLog) {
                            moderator = nameLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildNameUpdate', {
                    oldName: oldGuild.name,
                    newName: newGuild.name,
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.description !== newGuild.description) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const descLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'description') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (descLog) {
                            moderator = descLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildDescriptionUpdate', {
                    oldDescription: oldGuild.description,
                    newDescription: newGuild.description,
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const vanityLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'vanity_url_code') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (vanityLog) {
                            moderator = vanityLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildVanityURLUpdate', {
                    oldVanityURL: oldGuild.vanityURLCode,
                    newVanityURL: newGuild.vanityURLCode,
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const verifyLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'verification_level') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (verifyLog) {
                            moderator = verifyLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildVerificationLevelUpdate', {
                    oldLevel: oldGuild.verificationLevel,
                    newLevel: newGuild.verificationLevel,
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }

            if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
                let moderator = null;

                if (!auditLogPermissionsMissing) {
                    try {
                        const auditLogs = await guild.fetchAuditLogs({
                            type: AuditLogEvent.GuildUpdate,
                            limit: 5
                        });

                        const localeLog = auditLogs.entries.find(entry =>
                            entry.changes?.some(c => c.key === 'preferred_locale') &&
                            (Date.now() - entry.createdTimestamp) < 5000
                        );

                        if (localeLog) {
                            moderator = localeLog.executor;
                        }
                    } catch (err) {
                        if (err.code === 50013) auditLogPermissionsMissing = true;
                    }
                }

                await modLog.logEvent(bot, guild.id, 'guildLocaleUpdate', {
                    oldLocale: oldGuild.preferredLocale,
                    newLocale: newGuild.preferredLocale,
                    moderator: moderator,
                    auditLogPermissionsMissing: auditLogPermissionsMissing
                });
            }
        } catch (error) {
            logger.error('Error in guildUpdate event:', error);
        }
    }
};


// contributors: @relentiousdragon