const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const { Server } = require("../../schemas/servers.js");
const { ServerStats } = require("../../schemas/serverStats.js");
const graphRenderer = require("../../util/statsGraphRenderer.js");

const statsCache = new Map();

async function getServerSettings(guildId) {
    const cached = statsCache.get(guildId);
    if (cached && Date.now() - cached.timestamp < 60 * 1000) {
        return cached.data;
    }
    const serverData = await Server.findOne({ serverID: guildId });
    statsCache.set(guildId, { data: serverData, timestamp: Date.now() });
    return serverData;
}

function clearStatsCache(guildId) {
    statsCache.delete(guildId);
}

async function getMessageStats(guildId, days = 7) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats?.length) return null;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filtered = stats.messageStats.filter(s => s.date >= cutoff);

    const dailyStats = new Map();
    for (const stat of filtered) {
        const day = stat.date.toISOString().split('T')[0];
        dailyStats.set(day, (dailyStats.get(day) || 0) + stat.count);
    }

    return {
        total: filtered.reduce((sum, s) => sum + s.count, 0),
        daily: [...dailyStats.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    };
}

async function getHourlyDistribution(guildId) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats?.length) return null;

    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const today = new Array(24).fill(0);
    const historical = new Array(24).fill(0);
    const dayCounts = new Array(24).fill(0);
    const seenDays = new Set();

    for (const stat of stats.messageStats) {
        const hour = stat.date.getUTCHours();
        const statDay = stat.date.toISOString().split('T')[0];

        if (stat.date >= startOfToday) {
            today[hour] += stat.count;
        } else {
            historical[hour] += stat.count;
            if (!seenDays.has(statDay)) {
                seenDays.add(statDay);
                for (let h = 0; h < 24; h++) dayCounts[h]++;
            }
        }
    }

    const average = historical.map((val, i) => dayCounts[i] ? Math.round(val / dayCounts[i]) : 0);

    return { today, average };
}

async function getTopUsers(guildId, limit = 10, days = 30) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats?.length) return [];

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filtered = stats.messageStats.filter(s => s.date >= cutoff);

    const userCounts = new Map();
    for (const stat of filtered) {
        userCounts.set(stat.userId, (userCounts.get(stat.userId) || 0) + stat.count);
    }

    return [...userCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([userId, count]) => ({ userId, count }));
}

async function getTopChannels(guildId, limit = 10, days = 30) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats?.length) return [];

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filtered = stats.messageStats.filter(s => s.date >= cutoff);

    const channelCounts = new Map();
    for (const stat of filtered) {
        channelCounts.set(stat.channelId, (channelCounts.get(stat.channelId) || 0) + stat.count);
    }

    return [...channelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([channelId, count]) => ({ channelId, count }));
}

async function getVcLeaderboard(guildId, limit = 10, days = 30) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.vcSessions?.length) return [];

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filtered = stats.vcSessions.filter(s => s.joinTime >= cutoff);

    const userDurations = new Map();
    for (const session of filtered) {
        userDurations.set(session.userId, (userDurations.get(session.userId) || 0) + session.duration);
    }

    return [...userDurations.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([userId, duration]) => ({ userId, duration }));
}

async function getInviteLeaderboard(guildId, limit = 10, days = 30) {

    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.memberJoins?.length) return [];

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filtered = stats.memberJoins.filter(j => j.joinedAt >= cutoff);

    const inviterCounts = new Map();
    for (const join of filtered) {
        if (join.inviterId) {
            inviterCounts.set(join.inviterId, (inviterCounts.get(join.inviterId) || 0) + 1);
        }
    }

    return [...inviterCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([inviterId, count]) => ({ inviterId, count }));
}

async function getUserStats(guildId, userId, days = 30) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats) return null;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const messages = stats.messageStats?.filter(s => s.userId === userId && s.date >= cutoff).reduce((sum, s) => sum + s.count, 0) || 0;
    const vcTime = stats.vcSessions?.filter(s => s.userId === userId && s.joinTime >= cutoff).reduce((sum, s) => sum + s.duration, 0) || 0;
    const invites = stats.memberJoins?.filter(s => s.inviterId === userId && s.joinedAt >= cutoff).length || 0;

    return { messages, vcTime, invites };
}

async function getTodaysMessages(guildId) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats?.length) return 0;

    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    return stats.messageStats
        .filter(s => s.date >= startOfToday)
        .reduce((sum, s) => sum + s.count, 0);
}

async function getMemberSegments(guild, guildId, days = 7) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats?.messageStats) return null;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentStats = stats.messageStats.filter(s => s.date >= cutoff);

    const activeUserIds = [...new Set(recentStats.map(s => s.userId))];
    if (activeUserIds.length === 0) return null;

    let newMembersCount = 0;
    let veteranMembersCount = 0;
    let regularMembersCount = 0;

    try {
        const members = await guild.members.fetch({ user: activeUserIds });

        for (const uid of activeUserIds) {
            const member = members.get(uid);
            if (!member) continue;

            const joinDate = member.joinedAt;
            const now = new Date();
            const daysSinceJoin = (now - joinDate) / (1000 * 60 * 60 * 24);

            const msgCount = getUserMessageCount(recentStats, uid);
            if (daysSinceJoin < 7) newMembersCount += msgCount;
            else if (daysSinceJoin > 90) veteranMembersCount += msgCount;
            else regularMembersCount += msgCount;
        }
    } catch (e) {
        logger.error(`[ServerStats] Bulk member fetch failed: ${e.message}`);
    }

    return { newMembersCount, veteranMembersCount, regularMembersCount };
}

function getUserMessageCount(stats, userId) {
    return stats.filter(s => s.userId === userId).reduce((a, b) => a + b.count, 0);
}

async function calculateTrend(guildId, days = 7) {
    const stats = await ServerStats.findOne({ guildId });
    if (!stats) return null;

    let currentMessages = 0;
    let previousMessages = 0;

    if (stats.dailySnapshots && stats.dailySnapshots.length >= 2) {
        const sortedSnapshots = [...stats.dailySnapshots].sort((a, b) => new Date(b.date) - new Date(a.date));
        const current = sortedSnapshots[0];

        let previous = sortedSnapshots.find(s => {
            const diffDays = (new Date(current.date) - new Date(s.date)) / (1000 * 3600 * 24);
            return diffDays >= days;
        }) || sortedSnapshots[sortedSnapshots.length - 1];

        const currentTime = new Date(current.date).getTime();
        const previousTime = new Date(previous.date).getTime();

        if (currentTime !== previousTime) {
            currentMessages = current.messages || 0;
            previousMessages = previous.messages || 0;
        }
    }

    if (currentMessages === 0 && previousMessages === 0 && stats.messageStats?.length > 0) {
        const now = new Date();
        const recentCutoff = new Date(now - days * 24 * 60 * 60 * 1000);
        const olderCutoff = new Date(now - days * 2 * 24 * 60 * 60 * 1000);

        currentMessages = stats.messageStats
            .filter(s => new Date(s.date) >= recentCutoff)
            .reduce((sum, s) => sum + s.count, 0);

        previousMessages = stats.messageStats
            .filter(s => new Date(s.date) >= olderCutoff && new Date(s.date) < recentCutoff)
            .reduce((sum, s) => sum + s.count, 0);
    }

    if (currentMessages === 0 && previousMessages === 0) return null;

    const msgChange = currentMessages - previousMessages;
    const msgPercent = previousMessages > 0 ? Math.round((msgChange / previousMessages) * 100) : (currentMessages > 0 ? 100 : 0);

    return {
        direction: msgChange >= 0 ? 'up' : 'down',
        percent: Math.abs(msgPercent),
        isStable: Math.abs(msgPercent) < 10
    };
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("serverstats")
        .setNameLocalizations(commandMeta.serverstats?.name || {})
        .setDescription("View and manage server statistics")
        .setDescriptionLocalizations(commandMeta.serverstats?.description || {})
        .addSubcommand(sub =>
            sub.setName("enable")
                .setNameLocalizations(commandMeta.serverstats?.enable_name || {})
                .setDescription("Enable server stats tracking (Admin only)")
                .setDescriptionLocalizations(commandMeta.serverstats?.enable_description || {})
        )
        .addSubcommand(sub =>
            sub.setName("disable")
                .setNameLocalizations(commandMeta.serverstats?.disable_name || {})
                .setDescription("Disable server stats tracking (Admin only)")
                .setDescriptionLocalizations(commandMeta.serverstats?.disable_description || {})
        )
        .addSubcommand(sub =>
            sub.setName("overview")
                .setNameLocalizations(commandMeta.serverstats?.overview_name || {})
                .setDescription("View server stats overview with message graph")
                .setDescriptionLocalizations(commandMeta.serverstats?.overview_description || {})
                .addIntegerOption(opt =>
                    opt.setName("days")
                        .setNameLocalizations(commandMeta.serverstats?.option_days_name || {})
                        .setDescription("Number of days to show (7, 14, or 30)")
                        .setDescriptionLocalizations(commandMeta.serverstats?.option_days_description || {})
                        .addChoices(
                            { name: "7 days", value: 7 },
                            { name: "14 days", value: 14 },
                            { name: "30 days", value: 30 }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName("activity")
                .setNameLocalizations(commandMeta.serverstats?.activity_name || {})
                .setDescription("View peak hours and activity patterns")
                .setDescriptionLocalizations(commandMeta.serverstats?.activity_description || {})
        )
        .addSubcommand(sub =>
            sub.setName("voice")
                .setNameLocalizations(commandMeta.serverstats?.voice_name || {})
                .setDescription("View voice channel activity leaderboard")
                .setDescriptionLocalizations(commandMeta.serverstats?.voice_description || {})
        )
        .addSubcommand(sub =>
            sub.setName("invites")
                .setNameLocalizations(commandMeta.serverstats?.invites_name || {})
                .setDescription("View invite tracking leaderboard")
                .setDescriptionLocalizations(commandMeta.serverstats?.invites_description || {})
        )
        .addSubcommand(sub =>
            sub.setName("export")
                .setNameLocalizations(commandMeta.serverstats?.export_name || {})
                .setDescription("Export server stats")
                .setDescriptionLocalizations(commandMeta.serverstats?.export_description || {})
                .addStringOption(opt =>
                    opt.setName("format")
                        .setNameLocalizations(commandMeta.serverstats?.export_option_format_name || {})
                        .setDescription("File format")
                        .setDescriptionLocalizations(commandMeta.serverstats?.export_option_format_description || {})
                        .addChoices({ name: "CSV", value: "csv" }, { name: "JSON", value: "json" })
                )
                .addChannelOption(opt =>
                    opt.setName("channel")
                        .setNameLocalizations(commandMeta.serverstats?.export_option_channel_name || {})
                        .setDescription("Channel for auto-export (Every 30d)")
                        .setDescriptionLocalizations(commandMeta.serverstats?.export_option_channel_description || {})
                        .addChannelTypes(0)
                )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: true,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: `${e.pixel_cross} This command can only be used in a server.`, flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        try {
            if (subcommand === 'enable' || subcommand === 'disable') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: `${e.pixel_cross} ${t('commands:serverstats.admin_only')}`, flags: MessageFlags.Ephemeral });
                }

                const serverData = await getServerSettings(guildId);
                const currentlyEnabled = serverData?.serverStats?.enabled || false;
                const wantsEnabled = subcommand === 'enable';

                if (currentlyEnabled === wantsEnabled) {
                    const alreadyMessage = wantsEnabled
                        ? t('commands:serverstats.already_enabled')
                        : t('commands:serverstats.already_disabled');
                    return interaction.reply({ content: `${e.pixel_cross} ${alreadyMessage}`, flags: MessageFlags.Ephemeral });
                }

                await Server.updateOne(
                    { serverID: guildId },
                    { $set: { 'serverStats.enabled': wantsEnabled } },
                    { upsert: true }
                );

                clearStatsCache(guildId);

                if (wantsEnabled) {
                    await ServerStats.getOrCreate(guildId);
                }

                const emoji = wantsEnabled ? e.pixel_check || '✅' : e.pixel_cross || '❌';
                const message = wantsEnabled ? t('commands:serverstats.enabled_success') : t('commands:serverstats.disabled_success');

                return interaction.reply({ content: `${emoji} ${message}` });
            }

            if (subcommand === 'export') {
                const format = interaction.options.getString('format') || 'json';
                const channel = interaction.options.getChannel('channel');
                const isDev = settings.devs?.includes(interaction.user.id);

                if (channel) {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                        return interaction.reply({ content: `${e.pixel_cross} ${t('commands:serverstats.export_admin_only')}`, flags: MessageFlags.Ephemeral });
                    }
                    await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

                    await ServerStats.updateOne(
                        { guildId },
                        {
                            $set: {
                                'exportConfig.enabled': true,
                                'exportConfig.channelId': channel.id,
                                'exportConfig.lastExportAt': new Date()
                            }
                        },
                        { upsert: true }
                    );
                    return interaction.editReply({ content: `${e.pixel_check} ${t('commands:serverstats.export_setup_success', { channel: channel.toString() })}` });
                }

                if (!isDev) {
                    return interaction.reply({
                        content: `${e.pixel_cross} ${t('commands:serverstats.export_dev_only')}`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

                const stats = await ServerStats.findOne({ guildId }).lean();
                if (!stats) return interaction.editReply({ content: `${e.not_found} ${t('commands:serverstats.no_data')}` });

                const MAX_ENTRIES = 100;

                const channelMap = new Map();
                stats.messageStats?.forEach(s => {
                    channelMap.set(s.channelId, (channelMap.get(s.channelId) || 0) + s.count);
                });
                const channelStats = [...channelMap.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_ENTRIES)
                    .map(([channelId, count]) => {
                        const ch = interaction.guild.channels.cache.get(channelId);
                        return { channelId, name: ch?.name || 'Unknown', messages: count };
                    });

                const userMap = new Map();
                stats.messageStats?.forEach(s => {
                    userMap.set(s.userId, (userMap.get(s.userId) || 0) + s.count);
                });
                const userStats = [...userMap.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_ENTRIES)
                    .map(([userId, count]) => ({ userId, messages: count }));

                const voiceChannelMap = new Map();
                stats.vcSessions?.forEach(s => {
                    voiceChannelMap.set(s.channelId, (voiceChannelMap.get(s.channelId) || 0) + s.duration);
                });
                const voiceByChannel = [...voiceChannelMap.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_ENTRIES)
                    .map(([channelId, seconds]) => {
                        const ch = interaction.guild.channels.cache.get(channelId);
                        return { channelId, name: ch?.name || 'Unknown', totalSeconds: seconds, formatted: funcs.formatDurationPretty(seconds * 1000, { maxUnit: 'd', excludeWeeks: true }) };
                    });

                const voiceUserMap = new Map();
                stats.vcSessions?.forEach(s => {
                    voiceUserMap.set(s.userId, (voiceUserMap.get(s.userId) || 0) + s.duration);
                });
                const voiceByUser = [...voiceUserMap.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, MAX_ENTRIES)
                    .map(([userId, seconds]) => ({ userId, totalSeconds: seconds, formatted: funcs.formatDurationPretty(seconds * 1000, { maxUnit: 'd', excludeWeeks: true }) }));

                const exportData = {
                    _meta: {
                        exportedBy: 'Waterfall Bot',
                        exportedAt: new Date().toISOString(),
                        guildId,
                        guildName: interaction.guild.name,
                        dataPeriod: 'Last 30 days (rolling)',
                        notes: [
                            'All statistics are based on the last 30 days of activity.',
                            'User and channel lists are capped at 100 entries each.',
                            'Voice time is measured in seconds.',
                            'All-time voice is cumulative since stats were enabled.'
                        ]
                    },
                    summary: {
                        totalMessages: userStats.reduce((a, b) => a + b.messages, 0),
                        totalVoiceSeconds: voiceByUser.reduce((a, b) => a + b.totalSeconds, 0),
                        totalVoiceFormatted: funcs.formatDurationPretty(voiceByUser.reduce((a, b) => a + b.totalSeconds, 0) * 1000, { maxUnit: 'd', excludeWeeks: true }),
                        allTimeVoiceMinutes: stats.allTimeVoiceMinutes || 0,
                        topChannelsCount: channelStats.length,
                        topUsersCount: userStats.length
                    },
                    channels: channelStats,
                    users: userStats,
                    voiceByChannel,
                    voiceByUser
                };

                let fileBuffer;
                let fileName;

                if (format === 'json') {
                    fileBuffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');
                    fileName = `stats_${guildId}_${Date.now()}.json`;
                } else {
                    const lines = [
                        `# Waterfall Server Stats Export`,
                        `# Server: ${interaction.guild.name} (${guildId})`,
                        `# Exported: ${new Date().toISOString()}`,
                        `# Data Period: Last 30 days (rolling)`,
                        `# Note: Lists are capped at 100 entries each`,
                        '',
                        '## Summary',
                        `Total Messages,${exportData.summary.totalMessages}`,
                        `Total Voice Time,${exportData.summary.totalVoiceFormatted}`,
                        `All-Time Voice (minutes),${exportData.summary.allTimeVoiceMinutes}`,
                        '',
                        '## Channels (Top 100 by messages)',
                        'ChannelID,Name,Messages',
                        ...channelStats.map(c => `${c.channelId},${c.name.replace(/,/g, '')},${c.messages}`),
                        '',
                        '## Users (Top 100 by messages)',
                        'UserID,Messages',
                        ...userStats.map(u => `${u.userId},${u.messages}`),
                        '',
                        '## Voice by Channel (Top 100 by time)',
                        'ChannelID,Name,Seconds,Formatted',
                        ...voiceByChannel.map(v => `${v.channelId},${v.name.replace(/,/g, '')},${v.totalSeconds},${v.formatted}`),
                        '',
                        '## Voice by User (Top 100 by time)',
                        'UserID,Seconds,Formatted',
                        ...voiceByUser.map(v => `${v.userId},${v.totalSeconds},${v.formatted}`)
                    ];
                    fileBuffer = Buffer.from(lines.join('\n'), 'utf-8');
                    fileName = `stats_${guildId}_${Date.now()}.csv`;
                }

                const moment = require("moment");
                const dailyData = [];
                const labels = [];
                if (stats.dailySnapshots && stats.dailySnapshots.length > 5) {
                    for (let i = 29; i >= 0; i--) {
                        const date = moment().subtract(i, 'days');
                        const snap = stats.dailySnapshots.find(s => moment(s.date).isSame(date, 'day'));
                        dailyData.push(snap?.messages || 0);
                        labels.push(date.format('MM/DD'));
                    }
                } else {
                    for (let i = 29; i >= 0; i--) {
                        const dateStart = moment().subtract(i, 'days').startOf('day').toDate();
                        const dateEnd = moment().subtract(i, 'days').endOf('day').toDate();
                        const dailyCount = (stats.messageStats || [])
                            .filter(s => s.date >= dateStart && s.date <= dateEnd)
                            .reduce((a, b) => a + b.count, 0);
                        dailyData.push(dailyCount);
                        labels.push(moment(dateStart).format('MM/DD'));
                    }
                }

                const graphBuffer = await graphRenderer.renderLineChart({
                    data: dailyData,
                    labels: labels,
                    title: 'Messages (30 days)',
                    width: 600,
                    height: 300
                });

                const cardBuffer = await graphRenderer.renderStatsCard({
                    stats: [
                        { label: 'Total Messages', value: funcs.abbr(exportData.summary.totalMessages), color: graphRenderer.COLORS.accent },
                        { label: 'Total Voice', value: exportData.summary.totalVoiceFormatted, color: graphRenderer.COLORS.success },
                        { label: 'Members', value: funcs.abbr(interaction.guild.memberCount) }
                    ],
                    title: '30-Day Summary',
                    width: 600,
                    height: 220
                });

                const graphAttachName = `graph_${Date.now()}.gif`;
                const cardAttachName = `card_${Date.now()}.png`;
                const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${e.download} Server Stats Export`),
                                new TextDisplayBuilder().setContent(`-# ${interaction.guild.name} - Last 30 days`)
                            )
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.guild.iconURL({ size: 1024 })))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${graphAttachName}`)))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${cardAttachName}`)))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t('commands:serverstats.export_contents')}`));

                await interaction.editReply({
                    content: null,
                    components: [container],
                    files: [
                        new AttachmentBuilder(graphBuffer, { name: graphAttachName }),
                        new AttachmentBuilder(cardBuffer, { name: cardAttachName })
                    ],
                    flags: MessageFlags.IsComponentsV2
                });

                return interaction.followUp({
                    content: `${e.download} **${t('commands:serverstats.export_complete')}** (${format.toUpperCase()})`,
                    files: [attachment],
                    //flags: MessageFlags.Ephemeral
                });

            }

            const serverData = await getServerSettings(guildId);
            if (!serverData?.serverStats?.enabled) {
                return interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:serverstats.not_enabled')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (subcommand === 'overview') {
                const COOLDOWN_OVERVIEW = 180000;
                if (serverData.serverStatsOverviewLastUpdate) {
                    const diff = Date.now() - serverData.serverStatsOverviewLastUpdate;
                    if (diff < COOLDOWN_OVERVIEW) {
                        const nextUpdate = Math.floor((serverData.serverStatsOverviewLastUpdate + COOLDOWN_OVERVIEW) / 1000);
                        return interaction.reply({
                            content: t("commands:serverstats.cooldown", { time: `<t:${nextUpdate}:R>` }),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            } else if (subcommand === 'activity') {
                const COOLDOWN_ACTIVITY = 60000;
                if (serverData.serverStatsActivityLastUpdate) {
                    const diff = Date.now() - serverData.serverStatsActivityLastUpdate;
                    if (diff < COOLDOWN_ACTIVITY) {
                        const nextUpdate = Math.floor((serverData.serverStatsActivityLastUpdate + COOLDOWN_ACTIVITY) / 1000);
                        return interaction.reply({
                            content: t("commands:serverstats.cooldown", { time: `<t:${nextUpdate}:R>` }),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }

            await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

            if (subcommand === 'overview') {
                const days = interaction.options.getInteger('days') || 7;
                const msgStats = await getMessageStats(guildId, days);
                const fullStats = await ServerStats.findOne({ guildId }).lean();

                if (!msgStats || msgStats.daily.length === 0) {
                    return interaction.editReply({ content: `${e.not_found} ${t('commands:serverstats.no_data')}` });
                }

                const graphBuffer = await graphRenderer.renderLineChart({
                    data: msgStats.daily.map(d => d[1]),
                    labels: msgStats.daily.map(d => d[0].slice(5)),
                    title: t('commands:serverstats.overview_graph_title', { days }),
                    width: 600,
                    height: 300
                });

                const allTopUsers = await getTopUsers(guildId, 10, days);
                const topUsers = allTopUsers.slice(0, 3);
                const restUsers = allTopUsers.slice(3);
                const restTotal = restUsers.reduce((a, b) => a + b.count, 0);

                const topChannels = await getTopChannels(guildId, 10, days);

                const cardStats = [
                    { label: t('commands:serverstats.total_messages', { days }), value: funcs.abbr(msgStats.total), color: graphRenderer.COLORS.accent },
                    { label: t('commands:serverstats.daily_average'), value: funcs.abbr(Math.round(msgStats.total / days)), color: graphRenderer.COLORS.success },
                ];

                const segments = await getMemberSegments(interaction.guild, guildId, days);
                let segmentBuffer = null;
                if (segments) {
                    segmentBuffer = await graphRenderer.renderSegmentDonut({
                        data: [
                            { label: t('commands:serverstats.segments_new'), value: segments.newMembersCount, color: graphRenderer.COLORS.success },
                            { label: t('commands:serverstats.segments_veteran'), value: segments.veteranMembersCount, color: graphRenderer.COLORS.accent },
                            { label: t('commands:serverstats.segments_regular'), value: segments.regularMembersCount, color: graphRenderer.COLORS.textDim }
                        ],
                        title: t('commands:serverstats.segments_title')
                    });
                }

                const trend = await calculateTrend(guildId, 7);
                if (trend) {
                    const sign = trend.direction === 'up' ? '+' : '-';
                    const trendText = trend.isStable
                        ? t('commands:serverstats.trend_stable')
                        : (trend.direction === 'up'
                            ? t('commands:serverstats.trend_up', { percent: trend.percent })
                            : t('commands:serverstats.trend_down', { percent: trend.percent }));

                    let color = graphRenderer.COLORS.textDim;
                    if (!trend.isStable) {
                        color = trend.direction === 'up' ? graphRenderer.COLORS.success : graphRenderer.COLORS.danger;
                    } else {
                        color = graphRenderer.COLORS.warning;
                    }

                    cardStats.push({
                        label: t('commands:serverstats.retention_trend'),
                        value: trendText,
                        color: color,
                        hasEmoji: false
                    });
                } else {
                    cardStats.push({ label: t('commands:serverstats.retention_trend'), value: 'Gathering...', hasEmoji: false });
                }

                if (topUsers[0]) {
                    const topUser = await bot.users.fetch(topUsers[0].userId).catch(() => null);
                    cardStats.push({ label: t('commands:serverstats.top_user'), value: topUser ? topUser.username : topUsers[0].userId });
                }

                if (topChannels[0]) {
                    const channel = interaction.guild.channels.cache.get(topChannels[0].channelId);
                    cardStats.push({ label: t('commands:serverstats.top_channel'), value: channel ? `#${channel.name}` : 'Unknown', hasEmoji: true });
                }


                const cardBuffer = await graphRenderer.renderStatsCard({
                    stats: cardStats,
                    title: t('commands:serverstats.quick_stats'),
                    width: 600,
                    height: 300
                });

                const graphAttachName = `stats_${Date.now()}.gif`;
                const cardAttachName = `card_${Date.now()}.png`;
                const segmentAttachName = `segments_${Date.now()}.gif`;




                const attachments = [
                    new AttachmentBuilder(graphBuffer, { name: graphAttachName }),
                    new AttachmentBuilder(cardBuffer, { name: cardAttachName }),
                    ...(segmentBuffer ? [new AttachmentBuilder(segmentBuffer, { name: segmentAttachName })] : [])
                ];

                const topUsersFormatted = await Promise.all(topUsers.map(async (u, i) => {
                    const user = await bot.users.fetch(u.userId).catch(() => null);
                    const name = user ? user.username : `<@${u.userId}>`;
                    //return `${['🥇', '🥈', '🥉'][i]} **${name}**: ${funcs.abbr(u.count)}`;
                    return `**${name}**: ${funcs.abbr(u.count)}`;
                }));

                if (restUsers.length > 0) {
                    topUsersFormatted.push(`-# ${t('commands:serverstats.leaderboard_remaining_generic', {
                        count: restUsers.length,
                        value: funcs.abbr(restTotal),
                        unit: t('commands:serverstats.messages').toLowerCase()
                    })}`);
                }

                const displayChannels = topChannels.slice(0, 3);
                const restChannels = topChannels.slice(3);
                const restChannelsTotal = restChannels.reduce((a, b) => a + b.count, 0);

                //const topChannelsFormatted = displayChannels.map((c, i) => `${['🥇', '🥈', '🥉'][i]} <#${c.channelId}>: ${funcs.abbr(c.count)}`);
                const topChannelsFormatted = displayChannels.map((c, i) => `<#${c.channelId}>: ${funcs.abbr(c.count)}`);
                if (restChannels.length > 0) {
                    topChannelsFormatted.push(`-# ${t('commands:serverstats.leaderboard_remaining_generic', {
                        count: restChannels.length,
                        value: funcs.abbr(restChannelsTotal),
                        unit: t('commands:serverstats.messages').toLowerCase()
                    })}`);
                }

                const statsText = [
                    //`${e.chart} **${t('commands:serverstats.total_messages', { days })}:** ${funcs.abbr(msgStats.total)}`,
                    //`${e.archive} **${t('commands:serverstats.total_messages_ever')}:** ${funcs.abbr(Math.max(fullStats?.totalMessages || 0, msgStats.total))}`,
                    //`${e.green_point} **${t('commands:serverstats.daily_average')}:** ${funcs.abbr(Math.round(msgStats.total / days))}`,
                    //'',
                    `### **${t('commands:serverstats.top_users')}:**`,
                    ...topUsersFormatted,
                    //'',
                    `### **${t('commands:serverstats.top_channels')}:**`,
                    ...topChannelsFormatted
                ].join('\n');

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${e.chart} ${t('commands:serverstats.overview_title')}`),
                                new TextDisplayBuilder().setContent(`-# ${interaction.guild.name}`)
                            )
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.guild.iconURL() || bot.user.displayAvatarURL()))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${graphAttachName}`)))
                    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${cardAttachName}`)));

                if (segmentBuffer) {
                    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${segmentAttachName}`).setDescription(t('commands:serverstats.segments_description'))))
                }

                let allTimeVoiceSeconds = (fullStats?.allTimeVoiceMinutes || 0) * 60;
                if (allTimeVoiceSeconds === 0 && fullStats?.vcSessions?.length > 0) {
                    allTimeVoiceSeconds = fullStats.vcSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
                }

                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${e.archive} **${t('commands:serverstats.total_messages_ever')}:** ${funcs.abbr(Math.max(fullStats?.totalMessages || 0, msgStats.total))}`))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${e.voice_channnel} **${t('commands:serverstats.all_time_voice')}:** ${funcs.formatDurationPretty(allTimeVoiceSeconds * 1000, { maxUnit: 'd', excludeWeeks: true })}`))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsText))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:serverstats.data_from_days', { days })}`));

                await Server.updateOne({ serverID: guildId }, { $set: { serverStatsOverviewLastUpdate: Date.now() } });

                return interaction.editReply({
                    content: null,
                    components: [container],
                    files: attachments,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                    allowedMentions: { parse: [] }
                });
            }

            if (subcommand === 'activity') {
                const hourlyData = await getHourlyDistribution(guildId);

                if (!hourlyData || (hourlyData.today.every(h => h === 0) && hourlyData.average.every(h => h === 0))) {
                    return interaction.editReply({ content: `${e.not_found} ${t('commands:serverstats.no_data')}` });
                }

                const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
                const graphBuffer = await graphRenderer.renderBarChart({
                    data: hourlyData.today,
                    backgroundData: hourlyData.average,
                    labels,
                    title: t('commands:serverstats.activity_by_hour'),
                    width: 700,
                    height: 300
                });

                const attachName = `activity_${Date.now()}.gif`;
                const attachment = new AttachmentBuilder(graphBuffer, { name: attachName });

                const peakHour = hourlyData.today.indexOf(Math.max(...hourlyData.today));
                const now = new Date();
                now.setUTCHours(peakHour, 0, 0, 0);
                const startTimestamp = Math.floor(now.getTime() / 1000);
                const endTimestamp = startTimestamp + 3600;
                const peakInfo = `-# ${e.calendar} **${t('commands:serverstats.peak_hour')}:** <t:${startTimestamp}:t> - <t:${endTimestamp}:t>`;

                const todaysMessages = await getTodaysMessages(guildId);
                const todaysMessagesText = `-# ${e.channel} **${t('commands:serverstats.messages_today')}:** ${funcs.abbr(todaysMessages)}`;

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${e.chart} ${t('commands:serverstats.activity_title')}`),
                                new TextDisplayBuilder().setContent(peakInfo),
                                new TextDisplayBuilder().setContent(todaysMessagesText)
                            )
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.guild.iconURL() || bot.user.displayAvatarURL()))
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(`attachment://${attachName}`).setDescription(t('commands:serverstats.hourly_activity'))
                        )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:serverstats.utc_time')}`));

                await Server.updateOne({ serverID: guildId }, { $set: { serverStatsActivityLastUpdate: Date.now() } });

                return interaction.editReply({ content: null, components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });

            }

            if (subcommand === 'voice') {
                const allVcData = await getVcLeaderboard(guildId);
                const vcLeaderboard = allVcData.slice(0, 10);
                const restVc = allVcData.slice(10);
                const restVcTime = restVc.reduce((a, b) => a + b.duration, 0);

                if (!allVcData.length) {
                    return interaction.editReply({ content: `${e.not_found} ${t('commands:serverstats.no_vc_data')}` });
                }

                let vcList = await Promise.all(vcLeaderboard.map(async (u, i) => {
                    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
                    const user = await bot.users.fetch(u.userId).catch(() => null);
                    const name = user ? user.username : `<@${u.userId}>`;
                    return `${medal} **${name}**: ${formatDuration(u.duration)}`;
                }));

                if (restVc.length > 0) {
                    vcList.push(`-# ${t('commands:serverstats.leaderboard_remaining_time', {
                        count: restVc.length,
                        time: formatDuration(restVcTime)
                    })}`);
                }

                vcList = vcList.join('\n');

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${e.voice_channnel} ${t('commands:serverstats.voice_leaderboard')}`))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${t('commands:serverstats.all_time_voice')}:** ${formatDuration(Math.floor((await ServerStats.findOne({ guildId }))?.allTimeVoiceMinutes || 0) * 60)}`))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(vcList))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:serverstats.last_30_days')}`));

                return interaction.editReply({
                    content: null,
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                    allowedMentions: { parse: [] }
                });
            }

            if (subcommand === 'invites') {
                const allInvites = await getInviteLeaderboard(guildId);
                const inviteLeaderboard = allInvites.slice(0, 10);
                const restInvites = allInvites.slice(10);
                const restInvitesCount = restInvites.reduce((a, b) => a + b.count, 0);

                if (!allInvites.length) {
                    return interaction.editReply({ content: `${e.not_found} ${t('commands:serverstats.no_invite_data')}` });
                }

                let inviteList = await Promise.all(inviteLeaderboard.map(async (u, i) => {
                    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
                    const user = await bot.users.fetch(u.inviterId).catch(() => null);
                    const name = user ? user.username : `<@${u.inviterId}>`;
                    const count = u.count !== undefined ? u.count : 0;
                    return `${medal} **${name}**: ${count} ${t('commands:serverstats.invites_count')}`;
                }));

                if (restInvites.length > 0) {
                    inviteList.push(`-# ${t('commands:serverstats.leaderboard_remaining_generic', {
                        count: restInvites.length,
                        value: restInvitesCount,
                        unit: t('commands:serverstats.invites_count')
                    })}`);
                }

                inviteList = inviteList.join('\n');

                const container = new ContainerBuilder()
                    .setAccentColor(0x5865F2)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${e.invite} ${t('commands:serverstats.invite_leaderboard')}`))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(inviteList))
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:serverstats.last_30_days')}`));

                return interaction.editReply({
                    content: null,
                    components: [container],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                    allowedMentions: { parse: [] }
                });
            }

        } catch (error) {
            if (error.message === 'Worker timeout') {
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: `${e.pixel_cross} ${t('common:timeout_error')}` });
                }
                return interaction.reply({ content: `${e.pixel_cross} ${t('common:timeout_error')}`, flags: MessageFlags.Ephemeral });
            }

            logger.error("[/serverstats] Error executing command:", error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: `${e.pixel_cross} An error occurred while executing the command.` });
            }
            return interaction.reply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral });
        }
    },
    help: {
        name: "serverstats",
        description: "View and manage server statistics",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1766491397
    }
};

// contributors: @relentiousdragon