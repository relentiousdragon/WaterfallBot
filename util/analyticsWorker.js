const Analytics = require("../schemas/analytics.js");
const ShardStats = require("../schemas/shardStats.js");
const logger = require("../logger.js");
const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, WebhookClient } = require("discord.js");
let settings;
let client;
let messageCount = 0;
let interactionCount = 0;
let commandUsage = {};
let topCommandsCache = [];
let lastCacheUpdate = 0;

const FLUSH_INTERVAL = 60 * 1000;
const CACHE_TTL = 10 * 60 * 1000;

async function flushData(bot) {
    if (messageCount === 0 && interactionCount === 0) {
        if (settings.debug == "true") logger.debug("[Analytics] No data to flush");
        return;
    }

    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);

    if (settings.debug == "true") {
        logger.debug(`[Analytics] Flushing data - Messages: ${messageCount}, Interactions: ${interactionCount}, Commands: ${Object.keys(commandUsage).length}`);
    }

    try {
        const update = {
            $inc: {
                messages: messageCount,
                interactions: interactionCount
            }
        };

        for (const [command, count] of Object.entries(commandUsage)) {
            update.$inc[`commandsUsage.${command}`] = count;
        }

        await Analytics.findOneAndUpdate(
            { timestamp: hourStart },
            update,
            { upsert: true, new: true }
        );

        if (settings.debug == "true") {
            logger.debug(`[Analytics] Successfully flushed to DB for hour ${hourStart.toISOString()}`);
        }

        messageCount = 0;
        interactionCount = 0;
        commandUsage = {};

    } catch (error) {
        logger.error("Failed to flush analytics data:", error);
    }
}

async function updateTopCommandsCache() {
    try {
        const now = Date.now();
        if (now - lastCacheUpdate < CACHE_TTL && topCommandsCache.length > 0) {
            if (settings.debug == "true") logger.debug("[Analytics] Using cached top commands");
            return;
        }

        if (settings.debug == "true") logger.debug("[Analytics] Updating top commands cache...");

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);

        const data = await Analytics.find({ timestamp: { $gte: cutoff } }).lean();

        const usage = {};
        data.forEach(entry => {
            if (entry.commandsUsage) {
                for (const [cmd, count] of Object.entries(entry.commandsUsage)) {
                    usage[cmd] = (usage[cmd] || 0) + count;
                }
            }
        });

        topCommandsCache = Object.entries(usage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));

        lastCacheUpdate = now;

        if (settings.debug == "true") {
            logger.debug(`[Analytics] Top commands cache updated - ${topCommandsCache.map(c => `${c.name}: ${c.count}`).join(', ')}`);
        }
    } catch (error) {
        logger.error("Failed to update top commands cache:", error);
    }
}

async function exportAnalytics() {
    try {
        const now = new Date();
        const data = await Analytics.find({}).sort({ timestamp: 1 }).lean();

        if (data.length === 0) {
            logger.info("Analytics Export: No data to export.");
            return;
        }

        let totalMessages = 0;
        let totalInteractions = 0;
        let totalCommandsUsed = 0;
        const commandUsage = {};
        const dailyData = {};
        let peakHour = { timestamp: null, messages: 0, interactions: 0 };
        let peakInteractionsHour = { timestamp: null, messages: 0, interactions: 0 };
        let rpsWaterfallWins = 0, rpsHumanWins = 0;
        let connect4WaterfallWins = 0, connect4HumanWins = 0;

        data.forEach(entry => {
            rpsWaterfallWins += entry.rpsWaterfallWins || 0;
            rpsHumanWins += entry.rpsHumanWins || 0;
            connect4WaterfallWins += entry.connect4WaterfallWins || 0;
            connect4HumanWins += entry.connect4HumanWins || 0;

            if (!entry.timestamp || new Date(entry.timestamp).getFullYear() < 2000) return;

            const msgs = entry.messages || 0;
            const ints = entry.interactions || 0;

            totalMessages += msgs;
            totalInteractions += ints;

            if (msgs > peakHour.messages) {
                peakHour = { timestamp: entry.timestamp, messages: msgs, interactions: ints };
            }
            if (ints > peakInteractionsHour.interactions) {
                peakInteractionsHour = { timestamp: entry.timestamp, messages: msgs, interactions: ints };
            }

            if (entry.commandsUsage) {
                for (const [cmd, count] of Object.entries(entry.commandsUsage)) {
                    commandUsage[cmd] = (commandUsage[cmd] || 0) + count;
                    totalCommandsUsed += count;
                }
            }

            const dateKey = new Date(entry.timestamp).toISOString().split("T")[0];
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { messages: 0, interactions: 0, commands: 0 };
            }
            dailyData[dateKey].messages += msgs;
            dailyData[dateKey].interactions += ints;
            dailyData[dateKey].commands += Object.values(entry.commandsUsage || {}).reduce((a, b) => a + b, 0);
        });

        const dailyArray = Object.entries(dailyData).map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date));
        const peakDay = dailyArray.reduce((max, d) => d.messages > max.messages ? d : max, { date: null, messages: 0, interactions: 0 });

        const sortedCommands = Object.entries(commandUsage).sort((a, b) => b[1] - a[1]);
        const allCommands = sortedCommands.map(([cmd, uses], i) => ({
            rank: i + 1,
            command: cmd,
            uses,
            percentage: totalCommandsUsed > 0 ? ((uses / totalCommandsUsed) * 100).toFixed(1) : "0.0"
        }));
        const topCommands = allCommands.slice(0, 10);

        const dayOfWeekData = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dailyArray.forEach(d => {
            const dayIndex = new Date(d.date).getDay();
            dayOfWeekData[dayNames[dayIndex]] += d.interactions;
        });

        const categories = {};
        if (client && client.slashCommands) {
            client.slashCommands.forEach(cmd => {
                if (cmd.help && cmd.help.name && cmd.help.category) {
                    const cat = cmd.help.category;
                    if (!categories[cat]) categories[cat] = [];
                    categories[cat].push(cmd.help.name);
                }
            });
        } else {
            logger.warn("Analytics: Client or slashCommands not available for category generation.");
        }

        const categoryTotals = {};
        for (const [cat, cmds] of Object.entries(categories)) {
            categoryTotals[cat] = cmds.reduce((sum, cmd) => sum + (commandUsage[cmd] || 0), 0);
        }

        const categorizedCmds = Object.values(categories).flat();
        const otherTotal = Object.entries(commandUsage)
            .filter(([cmd]) => !categorizedCmds.includes(cmd))
            .reduce((sum, [, count]) => sum + count, 0);
        if (otherTotal > 0) categoryTotals['Other'] = (categoryTotals['Other'] || 0) + otherTotal;

        const rpsTotal = rpsWaterfallWins + rpsHumanWins;
        const rpsWinRate = rpsTotal > 0 ? ((rpsWaterfallWins / rpsTotal) * 100).toFixed(1) : "0.0";
        const c4Total = connect4WaterfallWins + connect4HumanWins;
        const c4WinRate = c4Total > 0 ? ((connect4WaterfallWins / c4Total) * 100).toFixed(1) : "0.0";

        const firstDate = dailyArray.length > 0 ? dailyArray[0].date : now.toISOString().split("T")[0];
        const lastDate = dailyArray.length > 0 ? dailyArray[dailyArray.length - 1].date : now.toISOString().split("T")[0];
        const dayCount = dailyArray.length || 1;

        const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        };
        const periodStr = `${formatDate(firstDate)} to ${formatDate(lastDate)}`;

        let currentServers = 0, currentUsers = 0;
        let startServers = 0, startUsers = 0;

        try {
            const allShards = await ShardStats.find({});
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const guildBuckets = new Map();
            const userBuckets = new Map();
            const intervalMs = 60 * 60 * 1000;

            allShards.forEach(shard => {
                currentServers += shard.guildCount || 0;
                currentUsers += shard.userCount || 0;

                const processShardHistory = (history, buckets) => {
                    if (history && history.length > 0) {
                        history.forEach(entry => {
                            const entryTime = new Date(entry.timestamp);
                            if (entryTime >= startDate) {
                                const time = Math.floor(entryTime.getTime() / intervalMs) * intervalMs;
                                if (!buckets.has(time)) buckets.set(time, []);
                                buckets.get(time).push(entry.count);
                            }
                        });
                    }
                };

                processShardHistory(shard.guildHistory, guildBuckets);
                processShardHistory(shard.userHistory, userBuckets);

                if (shard.guildHistory && shard.guildHistory.length > 0) {
                    const valid = shard.guildHistory.filter(h => new Date(h.timestamp) >= startDate);
                    valid.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                    if (valid.length > 0) startServers += valid[0].count;
                    else startServers += shard.guildCount || 0;
                } else {
                    startServers += shard.guildCount || 0;
                }

                if (shard.userHistory && shard.userHistory.length > 0) {
                    const valid = shard.userHistory.filter(h => new Date(h.timestamp) >= startDate);
                    valid.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                    if (valid.length > 0) startUsers += valid[0].count;
                    else startUsers += shard.userCount || 0;
                } else {
                    startUsers += shard.userCount || 0;
                }
            });

            const processBuckets = (buckets) => {
                return Array.from(buckets.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([timestamp, counts]) => {

                        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
                        return { timestamp, count: Math.round(avg * allShards.length) };
                    });
            };
            var guildGrowthData = processBuckets(guildBuckets);
            var userGrowthData = processBuckets(userBuckets);
        } catch (err) {
            logger.error("Analytics: Failed to fetch ShardStats", err);
            currentServers = client ? client.guilds.cache.size : 0;
            currentUsers = client ? client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0) : 0;
            startUsers = currentUsers;
            var guildGrowthData = [];
            var userGrowthData = [];
        }

        const serverGrowth = currentServers - startServers;
        const userGrowth = currentUsers - startUsers;
        const serverGrowthPct = startServers > 0 ? ((serverGrowth / startServers) * 100).toFixed(1) : "0.0";
        const userGrowthPct = startUsers > 0 ? ((userGrowth / startUsers) * 100).toFixed(1) : "0.0";

        const report = {
            report: {
                title: "Waterfall Analytics Report",
                period: periodStr,
                generatedAt: now.toISOString(),
                totalRecords: data.length
            },
            summary: {
                totalServers: currentServers,
                totalUsers: currentUsers,
                serverGrowth,
                serverGrowthPct,
                userGrowth,
                userGrowthPct,
                totalMessages,
                totalInteractions,
                totalCommandsUsed,
                uniqueCommands: Object.keys(commandUsage).length,
                averageMessagesPerDay: Math.round(totalMessages / dayCount),
                averageInteractionsPerDay: Math.round(totalInteractions / dayCount)
            },
            peaks: {
                busiestHour: peakHour.timestamp ? { timestamp: peakHour.timestamp, messages: peakHour.messages, interactions: peakHour.interactions } : null,
                busiestInteractionsHour: peakInteractionsHour.timestamp ? { timestamp: peakInteractionsHour.timestamp, messages: peakInteractionsHour.messages, interactions: peakInteractionsHour.interactions } : null,
                busiestDay: peakDay.date ? { date: peakDay.date, messages: peakDay.messages, interactions: peakDay.interactions } : null
            },
            topCommands: allCommands,
            gameStats: {
                rps: { waterfallWins: rpsWaterfallWins, humanWins: rpsHumanWins, totalGames: rpsWaterfallWins + rpsHumanWins },
                connect4: { waterfallWins: connect4WaterfallWins, humanWins: connect4HumanWins, totalGames: connect4WaterfallWins + connect4HumanWins }
            },
            dailyTotals: dailyArray,
            growthHistory: {
                guilds: guildGrowthData,
                users: userGrowthData
            }
        };

        const jsonContent = JSON.stringify(report, null, 2);

        const csvRows = [
            "WATERFALL ANALYTICS REPORT",
            `Period,${periodStr}`,
            `Generated,${now.toISOString()}`,
            "",
            "SUMMARY",
            "Metric,Value,Growth,Growth %",
            `Total Servers,${currentServers.toLocaleString()},${serverGrowth > 0 ? '+' : ''}${serverGrowth},${serverGrowthPct}%`,
            `Total Users,${currentUsers.toLocaleString()},${userGrowth > 0 ? '+' : ''}${userGrowth},${userGrowthPct}%`,
            `Total Messages,${totalMessages.toLocaleString()},,`,
            `Total Interactions,${totalInteractions.toLocaleString()}`,
            `Total Commands Used,${totalCommandsUsed.toLocaleString()}`,
            `Unique Commands,${Object.keys(commandUsage).length}`,
            `Avg Messages/Day,${Math.round(totalMessages / dayCount)}`,
            `Avg Interactions/Day,${Math.round(totalInteractions / dayCount)}`,
            "",
            "PEAK ACTIVITY",
            "Type,Timestamp,Messages,Interactions",
            `Busiest Hour (Messages),${peakHour.timestamp || "N/A"},${peakHour.messages},${peakHour.interactions}`,
            `Busiest Hour (Interactions),${peakInteractionsHour.timestamp || "N/A"},${peakInteractionsHour.messages},${peakInteractionsHour.interactions}`,
            `Busiest Day,${peakDay.date || "N/A"},${peakDay.messages},${peakDay.interactions}`,
            "",
            "TOP COMMANDS",
            "Rank,Command,Uses,Percentage",
            ...topCommands.map(c => `${c.rank},${c.command},${c.uses},${c.percentage}%`),
            "",
            "GAME STATS",
            "Game,Waterfall Wins,Human Wins,Total",
            `RPS,${rpsWaterfallWins},${rpsHumanWins},${rpsWaterfallWins + rpsHumanWins}`,
            `Connect4,${connect4WaterfallWins},${connect4HumanWins},${connect4WaterfallWins + connect4HumanWins}`,
            "",
            "DAILY TOTALS",
            "Date,Messages,Interactions,Commands",
            ...dailyArray.map(d => `${d.date},${d.messages},${d.interactions},${d.commands}`)
        ];
        const csvContent = csvRows.join("\n");

        const htmlContent = generateHTMLReport(report, dailyArray, topCommands, {
            dayOfWeekData,
            categoryTotals,
            rpsWinRate,
            c4WinRate,
            rpsWaterfallWins,
            rpsHumanWins,
            connect4WaterfallWins,
            connect4HumanWins,
            guildGrowthData,
            userGrowthData
        });

        const tempDir = path.join(__dirname, "../temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const timestampStr = now.toISOString().replace(/[:.]/g, "-");
        const jsonPath = path.join(tempDir, `analytics_report_${timestampStr}.json`);
        const csvPath = path.join(tempDir, `analytics_report_${timestampStr}.csv`);
        const htmlPath = path.join(tempDir, `analytics_report_${timestampStr}.html`);

        fs.writeFileSync(jsonPath, jsonContent);
        fs.writeFileSync(csvPath, csvContent);
        fs.writeFileSync(htmlPath, htmlContent);

        if (settings.logWebhook && settings.logWebhook.length === 2) {
            const webhookClient = new WebhookClient({ id: settings.logWebhook[0], token: settings.logWebhook[1] });

            const files = [
                new AttachmentBuilder(jsonPath),
                new AttachmentBuilder(csvPath),
                new AttachmentBuilder(htmlPath)
            ];

            await webhookClient.send({
                content: `**Waterfall Analytics Report**\n> Period: ${periodStr}\n> Messages: ${totalMessages.toLocaleString()} | Interactions: ${totalInteractions.toLocaleString()}`,
                files: files
            });

            logger.info(`Analytics Export: Sent report for ${dayCount} days to webhook.`);
        } else {
            logger.warn("Analytics Export: logWebhook not configured.");
        }

        fs.unlinkSync(jsonPath);
        fs.unlinkSync(csvPath);
        fs.unlinkSync(htmlPath);

    } catch (error) {
        logger.error("Analytics Export Failed:", error);
    }
}

function generateHTMLReport(report, dailyArray, topCommands, extras = {}) {
    const dailyLabels = JSON.stringify(dailyArray.map(d => d.date));
    const dailyMessages = JSON.stringify(dailyArray.map(d => d.messages));
    const dailyInteractions = JSON.stringify(dailyArray.map(d => d.interactions));
    const cmdLabels = JSON.stringify(topCommands.slice(0, 7).map(c => c.command));
    const cmdData = JSON.stringify(topCommands.slice(0, 7).map(c => c.uses));

    const dowLabels = JSON.stringify(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    const dowData = JSON.stringify(Object.values(extras.dayOfWeekData || {}));

    const catLabels = JSON.stringify(Object.keys(extras.categoryTotals || {}));
    const catData = JSON.stringify(Object.values(extras.categoryTotals || {}));

    const guildGrowthData = extras.guildGrowthData || [];
    const userGrowthData = extras.userGrowthData || [];
    const growthLabels = JSON.stringify(guildGrowthData.map(d => new Date(d.timestamp).getTime()));
    const guildGrowthCounts = JSON.stringify(guildGrowthData.map(d => d.count));
    const userGrowthCounts = JSON.stringify(userGrowthData.map(d => d.count));

    const top3 = topCommands.slice(0, 3);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Waterfall Analytics Report</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg-dark: #05050a;
            --glass-bg: rgba(255, 255, 255, 0.03);
            --glass-border: rgba(255, 255, 255, 0.08);
            --primary: #3b82f6;
            --secondary: #5865f2;
            --accent: #8b5cf6;
            --success: #10b981;
            --text-main: #ffffff;
            --text-muted: #94a3b8;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            min-height: 100vh;
            padding: 40px 20px;
        }
        .bg-glow {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1;
            background: radial-gradient(circle at 20% 20%, rgba(59,130,246,0.15) 0%, transparent 50%),
                        radial-gradient(circle at 80% 80%, rgba(88,101,242,0.15) 0%, transparent 50%);
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            text-align: center; margin-bottom: 40px;
            animation: fadeIn 0.8s ease-out;
        }
        .header h1 {
            font-size: 2.5rem; font-weight: 700;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        .header .period { color: var(--text-muted); font-size: 1.1rem; }
        .stats-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 20px; margin-bottom: 40px;
        }
        .stat-card {
            background: var(--glass-bg); border: 1px solid var(--glass-border);
            border-radius: 16px; padding: 24px; text-align: center;
            animation: slideUp 0.6s ease-out backwards;
        }
        .stat-card:nth-child(1) { animation-delay: 0.1s; }
        .stat-card:nth-child(2) { animation-delay: 0.2s; }
        .stat-card:nth-child(3) { animation-delay: 0.3s; }
        .stat-card:nth-child(4) { animation-delay: 0.4s; }
        .stat-value {
            font-size: 2rem; font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
            color: var(--primary);
        }
        .stat-label { color: var(--text-muted); font-size: 0.9rem; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
        .stat-detail { font-size: 0.85rem; margin-top: 6px; font-weight: 500; }
        .stat-detail.good { color: var(--success); }
        .stat-detail.bad { color: #ef4444; }
        .charts-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 40px; }
        .chart-container {
            background: var(--glass-bg); border: 1px solid var(--glass-border);
            border-radius: 16px; padding: 24px;
            animation: slideUp 0.8s ease-out 0.5s backwards;
        }
        .chart-title {
            font-size: 1.1rem; font-weight: 600; margin-bottom: 20px;
            padding-left: 12px; border-left: 3px solid var(--primary);
        }
        .chart-wrapper { height: 300px; }
        .peak-section {
            background: var(--glass-bg); border: 1px solid var(--glass-border);
            border-radius: 16px; padding: 24px; margin-bottom: 40px;
            animation: slideUp 0.8s ease-out 0.6s backwards;
        }
        .peak-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; }
        .peak-item { background: rgba(255,255,255,0.02); border-radius: 12px; padding: 16px; }
        .peak-label { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 4px; }
        .peak-value { font-size: 1.3rem; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .peak-detail { color: var(--text-muted); font-size: 0.9rem; }
        .commands-table {
            background: var(--glass-bg); border: 1px solid var(--glass-border);
            border-radius: 16px; padding: 24px;
            animation: slideUp 0.8s ease-out 0.7s backwards;
        }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { padding: 12px; text-align: left; }
        th { color: var(--text-muted); font-weight: 500; font-size: 0.85rem; text-transform: uppercase; border-bottom: 1px solid var(--glass-border); }
        td { border-bottom: 1px solid rgba(255,255,255,0.03); }
        .rank { color: var(--primary); font-weight: 700; }
        .cmd-name { font-weight: 500; }
        .cmd-uses { font-family: 'JetBrains Mono', monospace; }
        .cmd-pct { color: var(--text-muted); }
        .footer { text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 40px; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) { 
            html, body { overflow-x: hidden; }
            body { padding: 10px; }
            .header { margin-bottom: 20px; }
            .header h1 { font-size: 1.8rem; }
            .charts-grid, .peak-grid { grid-template-columns: 1fr !important; gap: 15px; margin-bottom: 20px; }
            .stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px; margin-bottom: 20px; }
            .stat-card { padding: 12px; }
            .stat-value { font-size: 1.2rem; }
            .peak-grid { grid-template-columns: 1fr; } 
            .chart-wrapper { height: 200px; }
            .chart-container, .peak-section, .commands-table { padding: 12px; margin-bottom: 20px; }
        }
        .table-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table { width: 100%; min-width: 400px; border-collapse: collapse; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="bg-glow"></div>
    <div class="container">
        <div class="header">
            <h1>Waterfall Analytics</h1>
            <p class="period">${report.report.period}</p>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${report.summary.totalServers.toLocaleString()}</div>
                <div class="stat-label">Servers</div>
                <div class="stat-detail ${report.summary.serverGrowth >= 0 ? 'good' : 'bad'}">
                    ${report.summary.serverGrowth > 0 ? '+' : ''}${report.summary.serverGrowth} (${report.summary.serverGrowthPct}%)
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${report.summary.totalUsers.toLocaleString()}</div>
                <div class="stat-label">Users</div>
                <div class="stat-detail ${report.summary.userGrowth >= 0 ? 'good' : 'bad'}">
                    ${report.summary.userGrowth > 0 ? '+' : ''}${report.summary.userGrowth} (${report.summary.userGrowthPct}%)
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${report.summary.totalMessages.toLocaleString()}</div>
                <div class="stat-label">Messages</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${report.summary.totalInteractions.toLocaleString()}</div>
                <div class="stat-label">Interactions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${report.summary.totalCommandsUsed.toLocaleString()}</div>
                <div class="stat-label">Commands</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${report.summary.uniqueCommands}</div>
                <div class="stat-label">Unique Commands</div>
            </div>
        </div>

        <div class="peak-section">
            <h3 class="chart-title">Peak Activity</h3>
            <div class="peak-grid">
                <div class="peak-item">
                    <div class="peak-label">Busiest Day</div>
                    <div class="peak-value">${report.peaks.busiestDay?.date || 'N/A'}</div>
                    <div class="peak-detail">${report.peaks.busiestDay?.messages?.toLocaleString() || 0} messages, ${report.peaks.busiestDay?.interactions?.toLocaleString() || 0} interactions</div>
                </div>
                <div class="peak-item">
                    <div class="peak-label">Peak Hour (Messages)</div>
                    <div class="peak-value">${report.peaks.busiestHour?.messages?.toLocaleString() || 0}</div>
                    <div class="peak-detail">messages in one hour</div>
                </div>
                <div class="peak-item">
                    <div class="peak-label">Peak Hour (Interactions)</div>
                    <div class="peak-value">${report.peaks.busiestInteractionsHour?.interactions?.toLocaleString() || 0}</div>
                    <div class="peak-detail">interactions in one hour</div>
                </div>
                <div class="peak-item">
                    <div class="peak-label">Daily Avg Messages</div>
                    <div class="peak-value">${report.summary.averageMessagesPerDay.toLocaleString()}</div>
                    <div class="peak-detail">per day</div>
                </div>
                <div class="peak-item">
                    <div class="peak-label">Daily Avg Interactions</div>
                    <div class="peak-value">${report.summary.averageInteractionsPerDay.toLocaleString()}</div>
                    <div class="peak-detail">per day</div>
                </div>
            </div>
        </div>

        <div class="peak-section" style="animation-delay: 0.5s;">
            <h3 class="chart-title">Top 3 Commands</h3>
            <div class="peak-grid" style="grid-template-columns: repeat(3, 1fr);">
                ${top3.map((c, i) => `
                <div class="peak-item" style="text-align: center;">
                    <div class="peak-value" style="font-size: 1.5rem;">${c.command}</div>
                    <div class="peak-detail">${c.uses.toLocaleString()} uses (${c.percentage}%)</div>
                </div>`).join('')}
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <h3 class="chart-title">Activity Over Time</h3>
                <div class="chart-wrapper"><canvas id="activityChart"></canvas></div>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">Activity by Day of Week</h3>
                <div class="chart-wrapper"><canvas id="dowChart"></canvas></div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <h3 class="chart-title">Guild Growth (30d)</h3>
                <div class="chart-wrapper"><canvas id="guildGrowthChart"></canvas></div>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">User Growth (30d)</h3>
                <div class="chart-wrapper"><canvas id="userGrowthChart"></canvas></div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <h3 class="chart-title">Command Categories</h3>
                <div class="chart-wrapper"><canvas id="categoryChart"></canvas></div>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">Top Commands</h3>
                <div class="chart-wrapper"><canvas id="commandsChart"></canvas></div>
            </div>
        </div>

        <div class="charts-grid">
            <div class="commands-table">
                <h3 class="chart-title">Command Rankings</h3>
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>#</th><th>Command</th><th>Uses</th><th>Share</th></tr></thead>
                        <tbody>
                            ${topCommands.map(c => `<tr><td class="rank">${c.rank}</td><td class="cmd-name">${c.command}</td><td class="cmd-uses">${c.uses.toLocaleString()}</td><td class="cmd-pct">${c.percentage}%</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">Game Stats</h3>
                <div class="peak-grid" style="margin-top: 0;">
                    <div class="peak-item">
                        <div class="peak-label">Rock Paper Scissors</div>
                        <div class="peak-value">${extras.rpsWaterfallWins + extras.rpsHumanWins}</div>
                        <div class="peak-detail">Bot: ${extras.rpsWaterfallWins} (${extras.rpsWinRate}%) | Human: ${extras.rpsHumanWins}</div>
                    </div>
                    <div class="peak-item">
                        <div class="peak-label">Connect 4</div>
                        <div class="peak-value">${extras.connect4WaterfallWins + extras.connect4HumanWins}</div>
                        <div class="peak-detail">Bot: ${extras.connect4WaterfallWins} (${extras.c4WinRate}%) | Human: ${extras.connect4HumanWins}</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer">
            Generated on ${new Date(report.report.generatedAt).toLocaleString()}
        </div>
    </div>

    <script>
        const dailyLabels = ${dailyLabels};
        const dailyMessages = ${dailyMessages};
        const dailyInteractions = ${dailyInteractions};
        const cmdLabels = ${cmdLabels};
        const cmdData = ${cmdData};
        const dowLabels = ${dowLabels};
        const dowData = ${dowData};
        const catLabels = ${catLabels};
        const catData = ${catData};

        if (typeof Chart === 'undefined') {
            document.querySelectorAll('.chart-wrapper').forEach(el => {
                el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:8px;text-align:center;">Charts unavailable</div>';
            });
        } else {
            new Chart(document.getElementById('activityChart'), {
            type: 'line',
            data: {
                labels: dailyLabels,
                datasets: [
                    { label: 'Messages', data: dailyMessages, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4, fill: true },
                    { label: 'Interactions', data: dailyInteractions, borderColor: '#5865f2', backgroundColor: 'rgba(88,101,242,0.1)', tension: 0.4, fill: true }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8' } } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', maxTicksLimit: 10 } }
                }
            }
        });

        new Chart(document.getElementById('dowChart'), {
            type: 'bar',
            data: {
                labels: dowLabels,
                datasets: [{ label: 'Interactions', data: dowData, backgroundColor: '#8b5cf6', borderRadius: 4 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });

        new Chart(document.getElementById('categoryChart'), {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{ data: catData, backgroundColor: ['#3b82f6','#5865f2','#8b5cf6','#10b981','#f59e0b','#ef4444'], borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: '#94a3b8', padding: 12 } } }
            }
        });

        new Chart(document.getElementById('commandsChart'), {
            type: 'bar',
            data: {
                labels: cmdLabels,
                datasets: [{ label: 'Uses', data: cmdData, backgroundColor: '#5865f2', borderRadius: 4 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                }
            }
        });

        const commonGrowthOptions = {
             responsive: true, maintainAspectRatio: false,
             plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { title: ctx => ctx[0] ? new Date(ctx[0].parsed.x).toLocaleString() : '' } } },
             scales: {
                 y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                 x: { 
                     type: 'linear', 
                     grid: { display: false }, 
                     ticks: { 
                         color: '#94a3b8', maxTicksLimit: 8,
                         callback: function(val) { return new Date(val).toLocaleDateString([], {month:'short', day:'numeric'}); }
                     },
                     min: new Date().getTime() - (30 * 24 * 60 * 60 * 1000),
                     max: new Date().getTime()
                 }
             }
        };

        const growthTimestamps = ${growthLabels};
        const growthGuilds = ${guildGrowthCounts};
        const growthUsers = ${userGrowthCounts};

        if (growthTimestamps.length > 0) {
            const guildPoints = growthTimestamps.map((t, i) => ({ x: t, y: growthGuilds[i] }));
            const userPoints = growthTimestamps.map((t, i) => ({ x: t, y: growthUsers[i] }));

            try {
                new Chart(document.getElementById('guildGrowthChart'), {
                    type: 'line',
                    data: { datasets: [{ label: 'Guilds', data: guildPoints, borderColor: '#10b981', backgroundColor: '#10b9811A', tension: 0.4, fill: true, pointRadius: 0 }] },
                    options: commonGrowthOptions
                });

                new Chart(document.getElementById('userGrowthChart'), {
                    type: 'line',
                    data: { datasets: [{ label: 'Users', data: userPoints, borderColor: '#f59e0b', backgroundColor: '#f59e0b1A', tension: 0.4, fill: true, pointRadius: 0 }] },
                    options: commonGrowthOptions
                });
            } catch(e) { console.error("Chart Render Error", e); }
        }

        }
    </script>
</body>
</html>`;
}
//
module.exports = {
    init: (bot, botSettings) => {
        client = bot;
        settings = botSettings;
        setInterval(() => flushData(bot), FLUSH_INTERVAL);
        updateTopCommandsCache();
        setInterval(updateTopCommandsCache, CACHE_TTL);
    },
    trackMessage: () => {
        messageCount++;
    },
    trackInteraction: (commandName) => {
        interactionCount++;
        if (commandName) {
            commandUsage[commandName] = (commandUsage[commandName] || 0) + 1;
        }
    },
    getTopCommands: async () => {
        if (topCommandsCache.length === 0) {
            await updateTopCommandsCache();
        }
        return topCommandsCache;
    },
    exportAnalytics: exportAnalytics
};


// contributors: @relentiousdragon