const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder, WebhookClient, SeparatorBuilder, SeparatorSpacingSize } = require("discord.js");
const Lock = require("./schemas/lock.js");
const LOCK_KEY = "hourlyIncomeLock";
const moment = require("moment");
const funcs = require("./util/functions.js");
const logger = require("./logger.js");
const { i18n } = require("./util/i18n.js");
const users = require("./schemas/users.js");
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
            const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000));
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

            const reminders = await users.find({
                "preferences.notifications.vote": "DM",
                voteReminderSent: false,
                lastVote: { $lte: twelveHoursAgo }
            });

            const voteUrl = "https://top.gg/bot/1435231722714169435/vote";

            for (const user of reminders) {
                try {
                    const userLocale = user.locale || 'en';
                    const t = i18n.getFixedT(userLocale);
                    const isInactive = user.lastActive && new Date(user.lastActive).getTime() < thirtyDaysAgo.getTime();

                    const msgContent = t('events:interaction.vote_reminder_dm', { user: `<@${user.userID}>`, voteUrl: voteUrl });

                    const container = new ContainerBuilder()
                        .setAccentColor(0x5865F2)
                        .addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${e.discord_orbs} ${t('commands:vote.reminders_title')}`),
                                    new TextDisplayBuilder().setContent(msgContent)
                                )
                                .setButtonAccessory(
                                    new ButtonBuilder()
                                        .setLabel("Vote Now")
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(voteUrl)
                                )
                        );

                    if (isInactive) {
                        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
                        container.addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`-# ${t('events:interaction.vote_reminder_inactive_notice')}`)
                        );
                    }

                    const dmResult = await funcs.sendDM(bot, user.userID, { components: [container], flags: MessageFlags.IsComponentsV2 });
                    
                    if (dmResult.ok) {
                        user.voteReminderSent = true;
                        if (isInactive) {
                            user.preferences.notifications.vote = "OFF";
                        }
                        await user.save();
                    } else {
                        const isDMError = dmResult.err?.code === 50007 ||
                                          dmResult.err?.code === 50013 ||
                                          dmResult.err?.message?.includes("Cannot send messages to this user") ||
                                          dmResult.err?.message?.includes("Missing Permissions") ||
                                          dmResult.err?.message?.includes("User not found");
                        
                        if (isDMError) {
                            logger.debug(`Failed to send vote DM to ${user.userID}, switching to INTERACTION:`, dmResult.err);
                            user.preferences.notifications.vote = "INTERACTION";
                            user.preferences.notifications.voteNotice = true;
                            user.voteReminderSent = false;
                            await user.save();
                        } else {
                            logger.debug(`Failed to send vote DM to ${user.userID}:`, dmResult.err);
                        }
                    }
                } catch (err) {
                    logger.debug(`Failed to process vote reminder for ${user.userID}:`, err);
                }
            }

            const expiredMails = await GlobalMail.find({ expiry: { $lte: now } });
            const logWebhook = new WebhookClient({ id: settings.logWebhook[0], token: settings.logWebhook[1] });
            for (const mail of expiredMails) {
                try {
                    const previewEmbed = new EmbedBuilder()
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


// contributors: @relentiousdragon