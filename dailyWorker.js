const moment = require("moment");
//
module.exports = {
    send: async (bot) => {
        const Warns = require("./schemas/warns.js");
        const logger = require("./logger.js");
        const { ServerStats } = require("./schemas/serverStats.js");
        const { Server } = require("./schemas/servers.js");
        const { AttachmentBuilder } = require('discord.js');
        const i18next = require("i18next");

        try {
            const oneWeekAgo = moment().subtract(7, 'days').toDate();

            const result = await Warns.updateMany(
                { "warns.timestamp": { $lt: oneWeekAgo } },
                { $pull: { warns: { timestamp: { $lt: oneWeekAgo } } } }
            );

            if (result.modifiedCount > 0) {
                logger.warnAlert(`[DailyWorker] Cleaned up expired warns from ${result.modifiedCount} users.`);
            }
        } catch (error) {
            logger.error("[DailyWorker] Failed to cleanup warns:", error);
        }

        try {
            const { cleanupPendingDeletions } = require("./util/dataCleanup.js");
            const result = await cleanupPendingDeletions();
            if (result.deleted > 0) {
                logger.warnAlert(`[DailyWorker] Cleaned up ${result.deleted} pending server deletions.`);
            }
        } catch (error) {
            logger.error("[DailyWorker] Failed to cleanup pending deletions:", error);
        }

        try {
            const statsEnabledServers = await Server.find({ "serverStats.enabled": true }).select("serverID language");

            for (const server of statsEnabledServers) {
                const guildId = server.serverID;
                const t = i18next.getFixedT(server.language || 'en');

                try {
                    await ServerStats.cleanupOldData(guildId);

                    const stats = await ServerStats.findOne({ guildId });
                    if (stats) {
                        const yesterday = moment.utc().subtract(1, 'day').startOf('day').toDate();
                        const nextDay = moment.utc().subtract(1, 'day').endOf('day').toDate();

                        const dailyMessages = (stats.messageStats || [])
                            .filter(s => s.date >= yesterday && s.date <= nextDay)
                            .reduce((sum, s) => sum + s.count, 0);

                        const dailyVoice = (stats.vcSessions || [])
                            .filter(s => s.leaveTime >= yesterday && s.leaveTime <= nextDay)
                            .reduce((sum, s) => sum + s.duration, 0);

                        const guild = bot.guilds.cache.get(guildId);
                        const memberCount = guild ? guild.memberCount : 0;

                        await ServerStats.updateOne(
                            { guildId },
                            {
                                $pull: { dailySnapshots: { date: { $gte: yesterday, $lte: nextDay } } },
                                $push: {
                                    dailySnapshots: {
                                        date: yesterday,
                                        messages: dailyMessages,
                                        voiceMinutes: Math.floor(dailyVoice / 60),
                                        memberCount: memberCount
                                    }
                                }
                            }
                        );

                        stats.dailySnapshots = stats.dailySnapshots || [];
                        const dayIndex = stats.dailySnapshots.findIndex(s => moment.utc(s.date).isSame(moment.utc(yesterday), 'day'));
                        const newSnap = {
                            date: yesterday,
                            messages: dailyMessages,
                            voiceMinutes: Math.floor(dailyVoice / 60),
                            memberCount: memberCount
                        };
                        if (dayIndex >= 0) {
                            stats.dailySnapshots[dayIndex] = newSnap;
                        } else {
                            stats.dailySnapshots.push(newSnap);
                        }

                        if (stats.exportConfig?.enabled && stats.exportConfig?.channelId) {
                            const lastExport = stats.exportConfig.lastExportAt ? moment.utc(stats.exportConfig.lastExportAt) : moment.utc(0);
                            const daysSinceExport = moment.utc().diff(lastExport, 'days');

                            if (daysSinceExport >= 30) {
                                const exportChannel = bot.channels.cache.get(stats.exportConfig.channelId);
                                if (exportChannel) {
                                    const csvRows = ["Date,Messages,Voice (Minutes),New Members"];

                                    for (let i = 29; i >= 0; i--) {
                                        const date = moment.utc().subtract(i, 'days');
                                        const startOfDay = date.clone().startOf('day');
                                        const endOfDay = date.clone().endOf('day');
                                        const dateStr = date.format('YYYY-MM-DD');

                                        const snapshot = stats.dailySnapshots.find(s =>
                                            moment.utc(s.date).isSame(date, 'day')
                                        );

                                        if (snapshot) {
                                            csvRows.push(`${dateStr},${snapshot.messages},${snapshot.voiceMinutes},${snapshot.memberCount || 0}`);
                                        } else {
                                            const dailyMessages = stats.messageStats
                                                .filter(s => s.date >= startOfDay.toDate() && s.date <= endOfDay.toDate())
                                                .reduce((sum, s) => sum + s.count, 0);

                                            const dailyVoice = stats.vcSessions
                                                .filter(s => s.leaveTime >= startOfDay.toDate() && s.leaveTime <= endOfDay.toDate())
                                                .reduce((sum, s) => sum + s.duration, 0);

                                            csvRows.push(`${dateStr},${dailyMessages},${Math.floor(dailyVoice / 60)},0`);
                                        }
                                    }

                                    const csvBuffer = Buffer.from(csvRows.join('\n'), 'utf-8');
                                    const csvAttachment = new AttachmentBuilder(csvBuffer, { name: `stats_export_${guildId}_${moment.utc().format('YYYY-MM-DD')}.csv` });

                                    const graphRenderer = require("./util/statsGraphRenderer.js");
                                    const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
                                    const funcs = require("./util/functions.js");

                                    const dailyData = [];
                                    const labels = [];
                                    for (let i = 29; i >= 0; i--) {
                                        const date = moment.utc().subtract(i, 'days');
                                        const snap = stats.dailySnapshots?.find(s => moment.utc(s.date).isSame(date, 'day'));
                                        dailyData.push(snap?.messages || 0);
                                        labels.push(date.format('MM/DD'));
                                    }

                                    const totalMessages = dailyData.reduce((a, b) => a + b, 0);
                                    const totalVoice = (stats.vcSessions || []).reduce((sum, s) => sum + (s.duration || 0), 0);

                                    const graphBuffer = await graphRenderer.renderLineChart({
                                        data: dailyData,
                                        labels: labels,
                                        title: t('commands:serverstats.overview_graph_title', { days: 30 }),
                                        width: 600,
                                        height: 300
                                    });

                                    const cardBuffer = await graphRenderer.renderStatsCard({
                                        stats: [
                                            { label: t('commands:serverstats.total_messages', { days: 30 }), value: funcs.abbr(totalMessages), color: graphRenderer.COLORS.accent },
                                            { label: t('commands:serverstats.voice_time'), value: funcs.formatDurationPretty(totalVoice * 1000), color: graphRenderer.COLORS.success },
                                            { label: t('commands:serverstats.members'), value: funcs.abbr(memberCount || 0) }
                                        ],
                                        title: t('commands:serverstats.export_summary_title'),
                                        width: 600,
                                        height: 220
                                    });

                                    const graphAttachName = `graph_${Date.now()}.gif`;
                                    const cardAttachName = `card_${Date.now()}.png`;

                                    const container = new ContainerBuilder()
                                        .setAccentColor(0x5865F2)
                                        .addSectionComponents(
                                            new SectionBuilder()
                                                .addTextDisplayComponents(
                                                    new TextDisplayBuilder().setContent(`# ${t('commands:serverstats.export_title_auto')}`),
                                                    new TextDisplayBuilder().setContent(`-# ${guild?.name || guildId} • ${t('commands:serverstats.last_30_days')}`)
                                                )
                                        )
                                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${graphAttachName}`)))
                                        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${cardAttachName}`)))
                                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t('commands:serverstats.export_contents')}`));

                                    await exportChannel.send({
                                        components: [container],
                                        files: [
                                            new AttachmentBuilder(graphBuffer, { name: graphAttachName }),
                                            new AttachmentBuilder(cardBuffer, { name: cardAttachName })
                                        ],
                                        flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications
                                    });

                                    await exportChannel.send({
                                        content: `${t('commands:serverstats.export_message_content')}\n-# ${moment.utc().locale(server.language || 'en').format('MMMM D, YYYY')}`,
                                        files: [csvAttachment],
                                        flags: MessageFlags.SuppressNotifications
                                    });

                                    await ServerStats.updateOne(
                                        { guildId },
                                        { $set: { 'exportConfig.lastExportAt': moment.utc().toDate() } }
                                    );
                                    logger.debug(`[DailyWorker] Sent auto-export for guild ${guildId}`);
                                } else {
                                    logger.warn(`[DailyWorker] Export channel ${stats.exportConfig.channelId} not found for guild ${guildId}, disabling export.`);
                                    await ServerStats.updateOne(
                                        { guildId },
                                        { $set: { 'exportConfig.enabled': false } }
                                    );
                                }
                            }
                        }
                    }
                } catch (innerErr) {
                    logger.error(`[DailyWorker] Error processing stats for guild ${guildId}: `, innerErr);
                }
            }
        } catch (error) {
            logger.error("[DailyWorker] Failed to process server stats tasks:", error);
        }
    }
};


// contributors: @relentiousdragon