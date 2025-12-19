const Analytics = require("../schemas/analytics.js");
const logger = require("../logger.js");
const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, WebhookClient } = require("discord.js");
let settings;

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

        const jsonContent = JSON.stringify(data, null, 2);

        const headers = ["Timestamp", "Messages", "Interactions", "Commands"];
        const csvRows = [headers.join(",")];

        data.forEach(entry => {
            const cmdUsage = entry.commandsUsage ? Object.entries(entry.commandsUsage).map(([k, v]) => `${k}:${v}`).join(";") : "";
            const row = [
                entry.timestamp.toISOString(),
                entry.messages || 0,
                entry.interactions || 0,
                `"${cmdUsage}"`
            ];
            csvRows.push(row.join(","));
        });

        const csvContent = csvRows.join("\n");

        const tempDir = path.join(__dirname, "../temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const timestampStr = now.toISOString().replace(/[:.]/g, "-");
        const jsonPath = path.join(tempDir, `analytics_export_${timestampStr}.json`);
        const csvPath = path.join(tempDir, `analytics_export_${timestampStr}.csv`);

        fs.writeFileSync(jsonPath, jsonContent);
        fs.writeFileSync(csvPath, csvContent);

        if (settings.logWebhook1 && settings.logWebhook1.length === 2) {
            const webhookClient = new WebhookClient({ id: settings.logWebhook1[0], token: settings.logWebhook1[1] });

            const files = [
                new AttachmentBuilder(jsonPath),
                new AttachmentBuilder(csvPath)
            ];

            await webhookClient.send({
                content: `Analytics Export\nDate: ${now.toLocaleString()}\nRecords: ${data.length}`,
                files: files
            });

            logger.info(`Analytics Export: Sent ${data.length} records to webhook.`);
        } else {
            logger.warn("Analytics Export: logWebhook1 not configured.");
        }

        fs.unlinkSync(jsonPath);
        fs.unlinkSync(csvPath);

    } catch (error) {
        logger.error("Analytics Export Failed:", error);
    }
}

module.exports = {
    init: (bot, botSettings) => {
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
