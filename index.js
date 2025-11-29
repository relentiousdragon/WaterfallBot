const { Client, GatewayIntentBits, Partials, WebhookClient, Events, ActivityType, Collection } = require("discord.js");
const path = require("path");
const requireAll = require("require-all");
const fs = require("fs");
const cron = require("cron");
const axios = require("axios");
const express = require("express");
const crypto = require("crypto");
const { exec } = require("child_process");
require("dotenv").config();

const { deployCommands } = require("./deploy-commands");
const mongoose = require("./mongoose.js");
const hourlyWorker = require("./hourlyWorker.js");
const dailyWorker = require("./dailyWorker.js");
const users = require("./schemas/users.js");
const ShardStats = require("./schemas/shardStats.js");
const logger = require("./logger.js");

const settingsPath = path.join(__dirname, "./util/settings.json");
let settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

const shardId = parseInt(process.env.SHARD_ID, 10);
const shardCount = 1;

let shardCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 10000;

function saveSettings() {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
    } catch (error) {
        logger.error("Error saving settings:", error);
    }
}

module.exports.settings = settings;
module.exports.saveSettings = saveSettings;

// BEEP BOOP
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.User,
    ],
    shardId: shardId,
    shardCount: shardCount,
});

const app = express();
app.use(express.json());

const rateLimit = require("express-rate-limit");

const shardsLimiter = rateLimit({
    windowMs: 7 * 1000,
    max: 1,
    message: {
        ok: false,
        error: "Too many requests, please try again in 7 seconds."
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
            logger.info("Vote Webhook: Test Vote Initiated");
        else if (type !== "upvote")
            return res.status(400).send("Invalid vote type");

        try {
            let data = await users.findOne({ userID: user });
            if (!data) return res.status(200).send("Vote OK (user has no restaurant)");

            data.lastVote = Date.now();
            await data.save();

            logger.info("Vote Webhook: A User has Successfully Voted!");
            return res.status(200).send("Vote OK");
        } catch (error) {
            logger.error("Vote Webhook Error:", error);
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
        const mem = process.memoryUsage();
        const now = new Date();

        const updateData = {
            shardID: shardId,
            wsPing: Math.round(bot.ws.ping || 0),
            memory: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
            },
            uptimeSeconds: Math.floor(process.uptime()),
            updatedAt: now
        };

        const currentMinute = now.getMinutes();
        const currentSecond = now.getSeconds();

        if (currentMinute === 0 && currentSecond <= 30) {
            const guildCount = bot.guilds.cache.size;
            updateData.guildCount = guildCount;

            await ShardStats.updateOne(
                { shardID: shardId },
                {
                    $push: {
                        guildHistory: {
                            $each: [{ count: guildCount, timestamp: now }],
                            $slice: -720
                        }
                    }
                }
            );
        }

        await ShardStats.findOneAndUpdate(
            { shardID: shardId },
            updateData,
            { upsert: true }
        );

    } catch (err) {
        logger.error("Failed to update shard metrics:", err);
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

        logger.info(`Stats posted successfully (Shard ${shardId})`, res.status);
        logger.alert(`Stats posted successfully (Shard ${shardId}) ${res.status}`, "SUCCESS");
    } catch (err) {
        logger.error(
            "Failed to post Top.gg stats:",
            JSON.stringify(err.response?.data || err, null, 2)
        );
    }
}

bot.once(Events.ClientReady, async () => {
    logger.neon("-----------------------");
    logger.info(`Logged in as ${bot.user.tag}`);
    logger.info(`Shard ${shardId + 1}/${shardCount} online.`);

    await updateStatus();

    if (process.env.CANARY !== "true") {
        hourlyWorkerJob.start();
        if (shardId == 0) dailyCronJob.start();
    }

    // UNCOMMENT WHEN BOT IS ADDED TO TOP.GG BALDO
    /* if (shardId === 0 && process.env.CANARY !== "true") {
        setInterval(postStats, 30 * 60 * 1000);
        setTimeout(postStats, 15 * 1000);
    } */

    updateShardMetrics();
    setInterval(updateShardMetrics, 30 * 1000);
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

for (const name in events) {
    const event = events[name];
    bot.on(event.name, (...args) => event.execute(bot, ...args));
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

    for (const file of files) {
        const filepath = path.join(dir, file);
        const stats = await fs.promises.stat(filepath);

        if (stats.isDirectory()) {
            await getSlashCommands(filepath);
        } else if (stats.isFile() && file.endsWith(".js")) {
            const command = require(`./${filepath}`);
            bot.slashCommands.set(command.data.name, command);
            console.log("\x1b[34m%s\x1b[0m", `${command.data.name}.js loaded!`);
        }
    }
}

(async () => {
    /* logger.neon("-----------------------");
    logger.info("Setting up Prefix Commands...");
    await getCommands('./commands/'); */

    logger.neon("-----------------------");
    logger.info("Setting up Slash Commands...");
    await getSlashCommands("./slashCommands/");
})();


function analyzeGitHubChanges(changedFiles) {
    const hotReloadable = [
        "slashCommands/",
        "events/",
        "util/functions.js",
        "views/",
        "schemas/",
        "hourlyWorker.js",
        "dailyWorker.js"
    ];

    const shardRestartRequired = [
        "index.js",
        "mongoose.js",
        "shardManager.js",
        "data/",
        "util/interactionHandlers.js"
    ];

    const containerRestartRequired = [
        "bot.js",
        "github.sh",
        "logger.js"
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
            if (file.startsWith("slashCommands/")) {
                await reloadSlashCommandFromWebhook(bot, file);
            } else if (file.startsWith("events/")) {
                await reloadEventFromWebhook(bot, file);
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

    if (!command) return;

    const actualPath = traverseForCommand(path.join(__dirname, "./slashCommands"), commandName);
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

bot.login(process.env.token).catch(e => logger.error(e));
mongoose.init();

