const Discord = require("discord.js");
const Lock = require("./schemas/lock.js");
const LOCK_KEY = "hourlyIncomeLock";
const moment = require("moment");
const funcs = require("./util/functions.js");
const logger = require("./logger.js");
const GlobalMail = require("./schemas/global_mails.js");
const settings = require("./util/settings.json");
const e = require("./data/emoji.js");

const LOCK_TIMEOUT = 55 * 60 * 1000;

const acquireLock = async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT);
    try {
        const result = await Lock.findOneAndUpdate(
            { key: LOCK_KEY, $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }] },
            { key: LOCK_KEY, expiresAt },
            { upsert: true, new: true }
        );
        return result && result.expiresAt && result.expiresAt.getTime() === expiresAt.getTime();
    } catch (err) {
        if (err && err.code === 11000) {
            return false;
        }
        throw err;
    }
};

const releaseLock = async () => {
    try {
        await Lock.deleteOne({ key: LOCK_KEY });
    } catch (err) {
        logger.error("Failed to release lock:", err);
    }
};

const sleep = ms => new Promise(res => setTimeout(res, ms));
//
module.exports = {
    send: async (bot) => {
        const hasLock = await acquireLock();
        if (!hasLock) {
            logger.info("Another instance is already processing hourly worker. Skipping.");
            return;
        }

        try {
            const now = new Date();
            const expiredMails = await GlobalMail.find({ expiry: { $lte: now } });
            const logWebhook = new Discord.WebhookClient({ id: settings.logWebhook[0], token: settings.logWebhook[1] });
            for (const mail of expiredMails) {
                try {
                    const previewEmbed = new Discord.EmbedBuilder()
                        .setColor(mail.color || 0x3498DB)
                        .setTitle(mail.title || "Expired Mail")
                        .setDescription(mail.message || "[No content]")
                        .setFooter({ text: `Expired` })
                        .setTimestamp();
                    if (mail.thumbnail) previewEmbed.setThumbnail(mail.thumbnail);
                    await logWebhook.send({ username: "Waterfall Mail Archive", embeds: [previewEmbed] });
                } catch (err) {
                    logger.error("Failed to send expired mail preview:", err);
                }
                try {
                    await GlobalMail.deleteOne({ _id: mail._id });
                } catch (err) {
                    logger.error("Failed to delete expired mail:", err);
                }
            }
        } finally {
            await releaseLock();
        }
    }
};