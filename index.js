const { Client, GatewayIntentBits, Partials, WebhookClient, Events, ActivityType, Collection, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder } = require("discord.js");
const { i18n } = require("./util/i18n.js");
const path = require("path");
const requireAll = require("require-all");
const fs = require("fs");
const cron = require("cron");
const axios = require("axios");
const express = require("express");
const crypto = require("crypto");
const { exec } = require("child_process");
require("dotenv").config();
const e = require("./data/emoji.js");
const funcs = require("./util/functions.js");

const { deployCommands } = require("./deploy-commands");
const mongoose = require("./mongoose.js");
const hourlyWorker = require("./hourlyWorker.js");
const dailyWorker = require("./dailyWorker.js");
const users = require("./schemas/users.js");
const ShardStats = require("./schemas/shardStats.js");
const Analytics = require("./schemas/analytics.js");
const analyticsWorker = require("./util/analyticsWorker.js");
const logger = require("./logger.js");
const { initI18n } = require("./util/i18n.js");
const { settings, saveSettings } = require("./util/settingsModule.js");

const shardId = parseInt(process.env.SHARD_ID, 10);
const shardCount = 1;

let shardCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 10000;

let isClientReady = false;
let isShuttingDown = false;
const MAX_CONCURRENT_INSTANCES = 1;
let instanceCount = 0;

module.exports.settings = settings;
module.exports.saveSettings = saveSettings;

// BEEP BOOP
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.User,
        Partials.GuildMember
    ],
    shardId: shardId,
    shardCount: shardCount,
});

const app = express();
app.use(express.json());

const rateLimit = require("express-rate-limit");

const shardsLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 15,
    message: {
        ok: false,
        error: "Too many requests, please try again in 5 seconds."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

if (shardId == 0) {
    app.post("/topgg-webhook", async (req, res) => {
        const authorizationPassword = process.env.TOPGG_AUTH;
        if (req.headers["authorization"] !== authorizationPassword)
            return res.status(403).send("Forbidden");

        const { user, type } = req.body;

        if (type === "test")
            logger.info("[Vote Webhook] Test Vote Initiated");
        else if (type !== "upvote")
            return res.status(400).send("Invalid vote type");

        try {
            let data = await users.findOne({ userID: user });
            if (!data) return res.status(200).send("Vote OK (user missing in db)");

            data.lastVote = Date.now();
            data.voteReminderSent = false;
            await data.save();

            logger.debug(`[Vote Webhook] A User has Successfully Voted! (${user})`);
            res.status(200).send("Vote OK");

            const voteThanksPref = data.preferences?.notifications?.voteThanks || "DM";
            if (voteThanksPref === "DM") {
                const now = new Date();
                const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
                const isActive = data.lastActive && new Date(data.lastActive).getTime() >= fourteenDaysAgo.getTime();

                if (isActive) {
                    const userLocale = data.locale || 'en';
                    const t = i18n.getFixedT(userLocale);

                    const container = new ContainerBuilder()
                        .setAccentColor(0x5865F2)
                        .addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${e.confetti} ${t('commands:preferences.vote_thanks_title')}`),
                                    new TextDisplayBuilder().setContent(t('events:interaction.vote_thanks_dm'))
                                )
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder().setURL(bot.user.displayAvatarURL())
                                )
                        );

                    if ((data.preferences?.notifications?.vote || "OFF") === "OFF") {
                        container.addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`-# ${t('commands:vote.reminders_description')}`)
                                )
                                .setButtonAccessory(
                                    new ButtonBuilder()
                                        .setCustomId(`vote_enable_reminders_${user}`)
                                        .setLabel(t('commands:vote.enable_reminders'))
                                        .setStyle(ButtonStyle.Success)
                                        .setEmoji(funcs.parseEmoji(e.yellow_point))
                                )
                        );
                    }
                    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# ${t('events:interaction.vote_thanks_footer')}`)
                    )

                    const dmResult = await funcs.sendDM(bot, user, { components: [container], flags: MessageFlags.IsComponentsV2 });

                    if (!dmResult.ok) {
                        const isDMError = dmResult.err?.code === 50007 ||
                                          dmResult.err?.code === 50013 ||
                                          dmResult.err?.message?.includes("Cannot send messages to this user") ||
                                          dmResult.err?.message?.includes("Missing Permissions") ||
                                          dmResult.err?.message?.includes("User not found");
                        
                        if (isDMError) {
                            logger.warn(`Failed to send vote thanks DM to ${user}:`, dmResult.err);
                            try {
                                data.preferences.notifications.voteThanks = "OFF";
                                await data.save();
                            } catch (saveErr) {
                                logger.error("Failed to update voteThanks preference for user:", saveErr);
                            }
                        } else {
                            logger.error(`Unexpected error sending vote thanks DM to ${user}:`, dmResult.err);
                        }
                    }
                } else {
                    logger.debug(`[Vote Webhook] User ${user} inactive (> 14 days), skipping vote thanks DM`);
                }
            }
            return;
        } catch (error) {
            logger.error("[Vote Webhook] Error:", error);
            return res.status(500).send("Internal error");
        }
    });

    app.post("/github-webhook", async (req, res) => {
        const signature = req.headers["x-hub-signature-256"];
        const event = req.headers["x-github-event"];

        if (!signature || event !== "push") {
            return res.status(400).send("Invalid webhook");
        }

        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
        if (webhookSecret) {
            const hmac = crypto.createHmac("sha256", webhookSecret);
            hmac.update(JSON.stringify(req.body));
            const computedSignature = `sha256=${hmac.digest("hex")}`;

            if (computedSignature !== signature) {
                return res.status(403).send("Invalid signature");
            }
        }

        try {
            const { commits, repository, ref } = req.body;

            if (ref !== "refs/heads/main") {
                return res.status(200).send("Not main branch, ignoring");
            }

            const changedFiles = [...new Set(commits.flatMap(commit =>
                commit.added.concat(commit.modified, commit.removed)
            ))];

            const analysis = analyzeGitHubChanges(changedFiles);

            logger.info(`GitHub webhook: ${changedFiles.length} files changed`);
            logger.info(`Hot reload: ${analysis.hotReload.length}`);
            logger.info(`Shard restart: ${analysis.shardRestart.length}`);
            logger.info(`Container restart: ${analysis.containerRestart}`);

            await new Promise((resolve, reject) => {
                exec("git pull", (error, stdout, stderr) => {
                    if (error) {
                        logger.error("Git pull failed:", error);
                        return reject(error);
                    }
                    resolve();
                });
            });

            if (analysis.hotReload.length > 0) {
                await hotReloadFromGitHub(bot, analysis.hotReload);
            }


            await logger.alertSync(
                "GitHub Sync Summary:\n" +
                `Files Changed: ${changedFiles.length}\n` +
                `Hot Reload: ${analysis.hotReload.length}\n` +
                `Shard Restart Needed: ${analysis.shardRestart.length}\n` +
                `Container Restart: ${analysis.containerRestart ? "YES" : "NO"}`,
                "INFO"
            );

            if (analysis.containerRestart) {
                logger.warn("Container restart required.");
                logger.alert("Container restart required.");
                return res.status(200).send("Container restart required");
            }

            if (analysis.shardRestart.length > 0) {
                logger.warn("Shard restart required.");
                logger.alert("Shard restart required.");
                // setTimeout(() => process.exit(0), 5000);
                return res.status(200).send("Shard restart required");
            }

            return res.status(200).send("Hot reload completed");

        } catch (error) {
            logger.error("GitHub webhook error:", error);
            return res.status(500).send("Webhook processing failed");
        }
    });
}

app.use(express.static(path.join(__dirname, "views")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")));
app.get("/health", (req, res) => res.sendStatus(200));
if (shardId === 0 && process.env.CANARY !== "true") {

    app.get("/status", (req, res) => {
        res.sendFile(path.join(__dirname, "views", "shards.html"));
    });

    app.get("/api/shards", shardsLimiter, async (req, res) => {
        try {
            const now = Date.now();

            const mongoose = require("mongoose");
            if (mongoose.connection.readyState !== 1) {
                return res.status(503).json({
                    ok: false,
                    error: "Database not connected",
                    readyState: mongoose.connection.readyState
                });
            }

            if (shardCache && (now - lastCacheUpdate) < CACHE_TTL) {
                return res.json({ ok: true, shards: shardCache, cached: true });
            }

            const all = await ShardStats.find().sort({ shardID: 1 }).lean().maxTimeMS(5000);
            shardCache = all;
            lastCacheUpdate = now;

            res.json({ ok: true, shards: all, cached: false });
        } catch (e) {
            logger.error("Error fetching shard stats:", e);
            res.status(500).json({
                ok: false,
                error: "Database query failed",
                message: e.message
            });
        }
    });

    logger.bigSuccess("Dashboard + API online");

    app.get("/insights", (req, res) => {
        res.sendFile(path.join(__dirname, "views", "insights.html"));
    });

    app.get("/api/analytics", shardsLimiter, async (req, res) => {
        try {
            const range = req.query.range || "7d";
            let days = 7;
            if (range === "30d") days = 30;
            if (range === "24h") days = 1;

            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);

            const data = await Analytics.find({ timestamp: { $gte: cutoff } }).sort({ timestamp: 1 }).lean();
            res.json({ ok: true, data });
        } catch (error) {
            logger.error("Error fetching analytics:", error);
            res.status(500).json({ ok: false, error: "Internal Server Error" });
        }
    });

    const growthCache = {};

    app.get("/api/growth", shardsLimiter, async (req, res) => {
        try {
            const range = req.query.range || "7d";

            if (growthCache[range] && growthCache[range].expires > Date.now()) {
                return res.json(growthCache[range].data);
            }

            const now = new Date();
            let cutoffTime;
            let intervalMs = 60 * 1000;

            if (range === '24h') {
                cutoffTime = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            } else if (range === '7d') {
                cutoffTime = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
                intervalMs = 30 * 60 * 1000;
            } else if (range === '30d') {
                cutoffTime = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
                intervalMs = 60 * 60 * 1000;
            }

            const shards = await ShardStats.aggregate([
                {
                    $project: {
                        shardID: 1,
                        guildHistory: {
                            $filter: {
                                input: "$guildHistory",
                                as: "entry",
                                cond: { $gte: ["$$entry.timestamp", cutoffTime] }
                            }
                        },
                        userHistory: {
                            $filter: {
                                input: "$userHistory",
                                as: "entry",
                                cond: { $gte: ["$$entry.timestamp", cutoffTime] }
                            }
                        }
                    }
                }
            ]).option({ maxTimeMS: 5000 });

            const processHistory = (historyField) => {
                const buckets = new Map();

                shards.forEach(shard => {
                    if (shard[historyField]) {
                        shard[historyField].forEach(entry => {
                            const entryTime = new Date(entry.timestamp);
                            if (entryTime >= cutoffTime) {
                                const time = Math.floor(entryTime.getTime() / intervalMs) * intervalMs;
                                if (!buckets.has(time)) buckets.set(time, new Map());

                                const shardMap = buckets.get(time);
                                if (!shardMap.has(shard.shardID)) shardMap.set(shard.shardID, []);
                                shardMap.get(shard.shardID).push(entry.count);
                            }
                        });
                    }
                });

                return Array.from(buckets.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([timestamp, shardMap]) => {
                        let total = 0;
                        for (const counts of shardMap.values()) {
                            const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
                            total += avg;
                        }
                        return { timestamp, count: Math.round(total) };
                    });
            };

            const guildGrowth = processHistory('guildHistory');
            const userGrowth = processHistory('userHistory');

            const responseData = { ok: true, guildGrowth, userGrowth };

            growthCache[range] = {
                data: responseData,
                expires: Date.now() + (60 * 1000)
            };

            res.json(responseData);

        } catch (error) {
            logger.error("Error fetching growth data:", error);
            res.status(500).json({ ok: false, error: "Internal Server Error" });
        }
    });
}



app.listen(process.env.port, () => {
    logger.info(shardId === 0 ?
        `Webhook server running on port ${process.env.port}` :
        "Health Endpoint Started"
    );
    logger.alert(shardId === 0 ?
        `Webhook server running on port ${process.env.port}` :
        "Health Endpoint Started"
    );
});

async function updateShardMetrics() {
    if (process.env.CANARY === "true") {
        return;
    }
    try {
        const memoryUsage = process.memoryUsage();
        const guildCount = bot.guilds.cache.size;
        const userCount = bot.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const wsPing = bot.ws.ping;
        const uptimeSeconds = process.uptime();

        await ShardStats.findOneAndUpdate(
            { shardID: shardId },
            {
                $set: {
                    guildCount: guildCount,
                    userCount: userCount,
                    wsPing: wsPing,
                    memory: {
                        rss: memoryUsage.rss,
                        heapUsed: memoryUsage.heapUsed
                    },
                    uptimeSeconds: uptimeSeconds,
                    crashed: false,
                    lastCrash: null,
                    updatedAt: new Date()
                },
                $push: {
                    guildHistory: {
                        $each: [{ count: guildCount, timestamp: new Date() }],
                        $slice: -50000
                    },
                    userHistory: {
                        $each: [{ count: userCount, timestamp: new Date() }],
                        $slice: -50000
                    }
                }
            },
            { upsert: true }
        );
    } catch (error) {
        logger.error("Failed to update shard metrics:", error);
    }
}



bot.slashCommands = new Collection();

if (shardId == 0) {
    (async () => { await deployCommands(); })();
}

bot.logWebhook = new WebhookClient({ id: settings.logWebhook[0], token: settings.logWebhook[1] });
bot.commands = new Collection();

let hourlyWorkerJob = new cron.CronJob("0 * * * *", () => hourlyWorker.send(bot));
let dailyCronJob = new cron.CronJob("0 0 * * *", () => dailyWorker.send(bot));
let analyticsExportJob = new cron.CronJob("0 0 1 * *", () => analyticsWorker.exportAnalytics());


async function getTotalGuildCount() {
    const shards = await ShardStats.find();
    return shards.reduce((a, s) => a + (s.guildCount || 0), 0);
}

async function updateStatus() {
    const statuses = [
        { name: "your server!", type: ActivityType.Watching },
    ];

    const status = process.env.CANARY === 'true' ? 'idle' : 'online';

    let currentStatus = 0;
    await bot.user.setActivity(statuses[currentStatus].name, { type: statuses[currentStatus].type });
    await bot.user.setStatus(status);

    setInterval(async () => {
        if (settings.event.toLowerCase() === "maintenance") {
            return bot.user.setActivity("MAINTENANCE 🛠", { type: ActivityType.Custom });
        }

        const totalServerCount = await getTotalGuildCount().catch(() => "~200");

        statuses[1] = { name: `over ${totalServerCount} servers`, type: ActivityType.Watching };
        statuses[2] = { name: "/help", type: ActivityType.Listening };

        currentStatus = (currentStatus + 1) % statuses.length;

        await bot.user.setActivity(statuses[currentStatus].name, { type: statuses[currentStatus].type });
    }, 15 * 60 * 1000);
}

async function postStats() {
    try {
        const shards = await ShardStats.find().sort({ shardID: 1 });
        const shardCounts = shards.map(s => s.guildCount || 0);
        const total = shardCounts.reduce((a, b) => a + b, 0);

        const body = {
            server_count: total,
            shard_count: shardCount,
        };

        logger.debug("Posting to Top.gg:", JSON.stringify(body, null, 2));

        const res = await axios.post(
            `https://top.gg/api/bots/${bot.user.id}/stats`,
            body,
            { headers: { Authorization: process.env.TOPGG_TOKEN } }
        );

        logger.debug(`Stats posted successfully (Shard ${shardId})`, res.status);
        // logger.alert(`Stats posted successfully (Shard ${shardId}) ${res.status}`, "SUCCESS");
    } catch (err) {
        logger.error(
            "Failed to post Top.gg stats:",
            JSON.stringify(err.response?.data || err, null, 2)
        );
    }
}

bot.once(Events.ClientReady, async () => {
    if (isClientReady) {
        return;
    }
    isClientReady = true;
    instanceCount++;
    
    if (instanceCount > MAX_CONCURRENT_INSTANCES) {
        logger.fatal(`Multiple instances detected (count: ${instanceCount}). Killing excess instance to prevent duplication.`);
        process.exit(1);
    }

    logger.neon("-----------------------");
    logger.info(`Logged in as ${bot.user.tag}`);
    logger.info(`Shard ${shardId + 1}/${shardCount} online.`);

    await updateStatus();

    if (process.env.CANARY !== "true") {
        hourlyWorkerJob.start();
        if (shardId == 0) {
            dailyCronJob.start();
            analyticsExportJob.start();
            logger.info("Analytics Export scheduled for the 1st of every month at midnight")
        }
    }

    if (shardId === 0 && process.env.CANARY !== "true") {
        setInterval(postStats, 30 * 60 * 1000);
        setTimeout(postStats, 15 * 1000);
    }

    updateShardMetrics();
    setInterval(updateShardMetrics, 60 * 1000);
    analyticsWorker.init(bot, settings);

    if (shardId === 0 && process.env.CANARY !== "true") {
        const { cleanupPendingDeletions } = require("./util/dataCleanup.js");
        cleanupPendingDeletions().catch(e => logger.error("Startup cleanup failed:", e));
    }

    const inviteTracker = require("./util/inviteTracker.js");
    bot.guilds.cache.forEach(guild => inviteTracker.cacheInvites(guild));

    const hangmanState = require("./util/hangman_state.js");
    hangmanState.init(bot).catch(e => logger.error("Hangman init failed:", e));
});

bot.on("error", e => logger.error("Discord Error", e));
bot.on("warn", e => logger.warn("Discord Warn", e));

const events = requireAll({
    dirname: __dirname + "/events",
    filter: /^(?!-)(.+)\.js$/,
});

bot.on("shardError", (error, shardId) => logger.error(`Shard ${shardId} error:`, error));
process.on("unhandledRejection", reason => logger.error("Unhandled Rejection:", reason));
process.on("uncaughtException", error => logger.error("Uncaught Exception:", error));

let eventsLoaded = 0;
let eventsFailed = 0;
const totalEventFiles = Object.keys(events).length;

for (const name in events) {
    const event = events[name];
    try {
        bot.on(event.name, (...args) => event.execute(bot, ...args));
        eventsLoaded++;
    } catch (error) {
        eventsFailed++;
        logger.error(`Failed to load event ${name}:`, error);
    }
}

const eventLogMsg = `Events: ${eventsLoaded}/${totalEventFiles} loaded successfully${eventsFailed > 0 ? ` (${eventsFailed} failed)` : ''}`;
if (eventsFailed > 0) {
    logger.warn(eventLogMsg);
} else {
    logger.info(eventLogMsg);
}

async function getCommands(dir) {
    const files = await fs.promises.readdir(dir);

    for (const file of files) {
        const filepath = path.join(dir, file);
        const stats = await fs.promises.stat(filepath);

        if (stats.isDirectory()) {
            await getCommands(filepath);
        } else if (stats.isFile() && file.endsWith(".js")) {
            const command = require(`./${filepath}`);
            bot.commands.set(command.help.name, command);
            console.log("\x1b[33m%s\x1b[0m", `${command.help.name}.js loaded!`);
        }
    }
}

async function getSlashCommands(dir) {
    const files = await fs.promises.readdir(dir);
    let loaded = 0;
    let failed = 0;

    for (const file of files) {
        const filepath = path.join(dir, file);
        const stats = await fs.promises.stat(filepath);

        if (stats.isDirectory()) {
            const result = await getSlashCommands(filepath);
            loaded += result.loaded;
            failed += result.failed;
        } else if (stats.isFile() && file.endsWith(".js")) {
            try {
                const command = require(`./${filepath}`);
                bot.slashCommands.set(command.data.name, command);
                console.log("\x1b[34m%s\x1b[0m", `${command.data.name}.js loaded!`);
                loaded++;
            } catch (error) {
                logger.error(`Failed to load command ${file}:`, error);
                failed++;
            }
        }
    }

    return { loaded, failed };
}

(async () => {
    /* logger.neon("-----------------------");
    logger.info("Setting up Prefix Commands...");
    await getCommands('./commands/'); */

    logger.neon("-----------------------");
    logger.info("Setting up Slash Commands...");
    const { loaded, failed } = await getSlashCommands("./slashCommands/");
    const { loaded: cLoaded, failed: cFailed } = await getSlashCommands("./contextCommands/");
    const total = loaded + failed + cLoaded + cFailed;
    const cmdLogMsg = `Slash Commands: ${loaded + cLoaded}/${total} loaded successfully${(failed + cFailed) > 0 ? ` (${failed + cFailed} failed)` : ''}`;
    if ((failed + cFailed) > 0) {
        logger.warn(cmdLogMsg);
    } else {
        logger.info(cmdLogMsg);
    }
})();


function analyzeGitHubChanges(changedFiles) {
    const hotReloadable = [
        "slashCommands/",
        "contextCommands/",
        "events/",
        "views/",
        "locales/"
    ];

    const shardRestartRequired = [
        "index.js",
        "mongoose.js",
        "shardManager.js",
        "data/",
        "util/interactionHandlers.js",
        "util/functions.js",
        "util/modLog.js",
        "util/statsGraphRenderer.js",
        "util/connect4_ai.js",
        "util/rps_ai.js",
        "util/inviteTracker.js",
        "util/duckduckgo.js",
        "util/analyticsWorker.js",
        "util/botDetection.js",
        "util/hangman_state.js",
        "schemas/",
        "hourlyWorker.js",
        "dailyWorker.js"
    ];

    const containerRestartRequired = [
        "bot.js",
        "github.sh",
        "logger.js",
        "package.json"
    ];

    const result = {
        hotReload: [],
        shardRestart: [],
        containerRestart: false
    };

    for (const file of changedFiles) {
        if (containerRestartRequired.some(restartFile => file.includes(restartFile))) {
            result.containerRestart = true;
        }

        if (shardRestartRequired.some(restartFile => file.includes(restartFile))) {
            result.shardRestart.push(file);
        }

        if (hotReloadable.some(reloadable => file.includes(reloadable))) {
            result.hotReload.push(file);
        }
    }

    return result;
}

async function hotReloadFromGitHub(bot, files) {
    for (const file of files) {
        try {
            if (file.startsWith("slashCommands/") || file.startsWith("contextCommands/")) {
                await reloadSlashCommandFromWebhook(bot, file);
            } else if (file.startsWith("events/")) {
                await reloadEventFromWebhook(bot, file);
            } else if (file.startsWith("locales/")) {
                await reloadLocaleFromWebhook(file);
            }
            logger.info(`GitHub Auto-Reload: ${file}`);
        } catch (error) {
            logger.error(`GitHub auto-reload failed for ${file}:`, error);
        }
    }
}

async function reloadSlashCommandFromWebhook(bot, filePath) {
    const commandName = path.basename(filePath, ".js");
    const command = bot.slashCommands.get(commandName);

    if (commandName === 'user' && filePath.includes('slashCommands')) {
        const contextPath = traverseForCommand(path.join(__dirname, "./contextCommands"), 'viewUser');
        if (contextPath) {
            delete require.cache[require.resolve(contextPath)];
            try {
                const newContextCommand = require(contextPath);
                bot.slashCommands.set(newContextCommand.data.name, newContextCommand);
                logger.info(`Dependent command viewUser.js reloaded`);
            } catch (error) {
                logger.error(`Dependent reload failed for viewUser:`, error);
            }
        }
    } else if (commandName === 'warn' && filePath.includes('slashCommands')) {
        const contextPath = traverseForCommand(path.join(__dirname, "./contextCommands"), 'warnUser');
        if (contextPath) {
            delete require.cache[require.resolve(contextPath)];
            try {
                const newContextCommand = require(contextPath);
                bot.slashCommands.set(newContextCommand.data.name, newContextCommand);
                logger.info(`Dependent command warnUser.js reloaded`);
            } catch (error) {
                logger.error(`Dependent reload failed for warnUser:`, error);
            }
        }
    }

    if (!command) return;

    let actualPath = traverseForCommand(path.join(__dirname, "./slashCommands"), commandName);
    if (!actualPath) {
        actualPath = traverseForCommand(path.join(__dirname, "./contextCommands"), commandName);
    }
    if (!actualPath) return;

    delete require.cache[require.resolve(actualPath)];

    try {
        const newCommand = require(actualPath);
        bot.slashCommands.set(newCommand.data.name, newCommand);
    } catch (error) {
        throw new Error(`Slash command reload failed: ${error.message}`);
    }
}

async function reloadEventFromWebhook(bot, filePath) {
    const eventPath = path.join(__dirname, "./events", filePath.replace("events/", ""));

    try {
        const currentEvent = require(eventPath);
        if (currentEvent.name) {
            bot.removeAllListeners(currentEvent.name);
        }
    } catch (error) {
        logger.warn(`Could not unload previous event for ${filePath}: ${error.message}`);
    }

    delete require.cache[require.resolve(eventPath)];

    try {
        const event = require(eventPath);
        bot.on(event.name, (...args) => event.execute(bot, ...args));
    } catch (error) {
        throw new Error(`Event reload failed: ${error.message}`);
    }
}

async function reloadLocaleFromWebhook(filePath) {
    const fullPath = path.join(__dirname, filePath);
    if (require.cache[require.resolve(fullPath)]) {
        delete require.cache[require.resolve(fullPath)];
    }

    const { reloadI18n } = require("./util/i18n.js");
    await reloadI18n();

    logger.info(`Cleared locale cache for: ${filePath}`);
}

function traverseForCommand(dir, filename) {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
        const direntPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
            const result = traverseForCommand(direntPath, filename);
            if (result) return result;
        }
        else if (dirent.name === filename + ".js") {
            return direntPath;
        }
    }
    return null;
}

bot.login(process.env.token).catch(e => {
    logger.error(e);
    process.exit(1);
});
mongoose.init();
initI18n();

process.once('SIGINT', () => {
    isShuttingDown = true;
    logger.warn('SIGINT received - shutting down gracefully');
    process.exit(0);
});

process.once('SIGTERM', () => {
    isShuttingDown = true;
    logger.warn('SIGTERM received - shutting down gracefully');
    process.exit(0);
});

process.on('message', async (message) => {
    if (message.type === 'reload-commands') {
        logger.info('Reloading all commands...');
        try {
            for (const [name, command] of bot.slashCommands) {
                let commandPath = traverseForCommand(path.join(__dirname, './slashCommands'), name);
                if (!commandPath) {
                    commandPath = traverseForCommand(path.join(__dirname, './contextCommands'), name);
                }
                if (commandPath) {
                    delete require.cache[require.resolve(commandPath)];
                    const newCommand = require(commandPath);
                    bot.slashCommands.set(newCommand.data.name, newCommand);
                }
            }
            logger.info('All commands reloaded successfully');
        } catch (error) {
            logger.error('Failed to reload commands:', error);
        }
    } else if (message.type === 'reload-events') {
        logger.info('Reloading all events...');
        try {
            const eventsDir = path.join(__dirname, './events');
            const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));

            for (const file of eventFiles) {
                const eventName = file.split('.')[0];
                const eventPath = path.join(eventsDir, file);

                const currentEvent = require(eventPath);
                if (currentEvent.name) {
                    bot.removeAllListeners(currentEvent.name);
                }

                delete require.cache[require.resolve(eventPath)];

                const newEvent = require(eventPath);
                if (newEvent.once) {
                    bot.once(newEvent.name, (...args) => newEvent.execute(bot, ...args));
                } else {
                    bot.on(newEvent.name, (...args) => newEvent.execute(bot, ...args));
                }
            }
            logger.info('All events reloaded successfully');
        } catch (error) {
            logger.error('Failed to reload events:', error);
        }
    }
});


// contributors: @relentiousdragon
