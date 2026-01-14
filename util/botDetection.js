const { GlobalUserInfractions, BotDetectionSettings, NewUserTracking } = require("../schemas/botDetection.js");
const { Server } = require("../schemas/servers.js");
const logger = require("../logger.js");

const SUSPICIOUS_PATTERNS = [
    /^[a-z]{2,4}\d{4,}$/i,
    /^user\d+$/i,
    /^[a-z]+_[a-z]+\d+$/i,
    /^[a-z]{1,3}[0-9]{5,}$/i,
    /discord.*nitro/i,
    /free.*gift/i,
    /claim.*reward/i,
    /^[a-z]{8,}$/i
];

const SUSPICIOUS_DISPLAY_PATTERNS = [
    /free\s*nitro/i,
    /discord\s*gift/i,
    /claim\s*(your|now|here)/i,
    /steam\s*gift/i,
    /giveaway/i,
    /airdrop/i,
    /crypto\s*(gift|free)/i,
    /nft\s*(free|mint)/i
];

const TRUSTED_DOMAINS = [
    'discord.com', 'discord.gg', 'discordapp.com',
    'youtube.com', 'youtu.be',
    'twitter.com', 'x.com',
    'github.com', 'gitlab.com',
    'reddit.com',
    'twitch.tv',
    'spotify.com',
    'steam.com', 'steampowered.com',
    'imgur.com',
    'tenor.com', 'giphy.com',
    'wikipedia.org',
    'google.com', 'docs.google.com', 'drive.google.com'
];

const linkSpamTracker = new Map();
const settingsCache = new Map();

async function getSettings(serverID) {
    const cached = settingsCache.get(serverID);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
        return cached.data;
    }

    try {
        let settings = await BotDetectionSettings.findOne({ serverID }).lean();
        settingsCache.set(serverID, { data: settings, timestamp: Date.now() });

        if (!settings) {
            return null;
        }
        return settings;
    } catch (error) {
        logger.error(`[BotDetection] Error fetching settings for ${serverID}:`, error);
        return null;
    }
}

async function saveSettings(serverID, updates) {
    try {
        const updated = await BotDetectionSettings.findOneAndUpdate(
            { serverID },
            { $set: updates },
            { upsert: true, new: true }
        );
        settingsCache.set(serverID, { data: updated.toObject ? updated.toObject() : updated, timestamp: Date.now() });
        return updated;
    } catch (error) {
        logger.error(`[BotDetection] Error saving settings for ${serverID}:`, error);
        return null;
    }
}

function calculateConfidence(member, settings) {
    let confidence = 0;
    const reasons = [];
    const checks = settings.checks || {};

    if (checks.defaultAvatar !== false && !member.user.avatar) {
        confidence += 15;
        reasons.push('default_avatar');
    }

    const accountAge = Date.now() - member.user.createdTimestamp;
    const TEN_MINUTES = 10 * 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

    if (checks.accountAge10m !== false && accountAge < TEN_MINUTES) {
        confidence += 30;
        reasons.push('account_age_10m');
    } else if (checks.accountAge1h !== false && accountAge < ONE_HOUR) {
        confidence += 20;
        reasons.push('account_age_1h');
    } else if (checks.accountAge1d !== false && accountAge < ONE_DAY) {
        confidence += 10;
        reasons.push('account_age_1d');
    } else if (checks.accountAge1w && accountAge < ONE_WEEK) {
        confidence += 5;
        reasons.push('account_age_1w');
    }

    if (checks.suspiciousUsername !== false) {
        const username = member.user.username.toLowerCase();
        for (const pattern of SUSPICIOUS_PATTERNS) {
            if (pattern.test(username)) {
                confidence += 15;
                reasons.push('suspicious_username');
                break;
            }
        }

        const displayName = member.displayName || member.user.displayName || '';
        for (const pattern of SUSPICIOUS_DISPLAY_PATTERNS) {
            if (pattern.test(displayName)) {
                confidence += 10;
                reasons.push('suspicious_display_name');
                break;
            }
        }
    }

    logger.debug(`[BotDetection] Calculated confidence for ${member.user.id}: ${Math.min(confidence, 100)}% (Reasons: ${reasons.join(', ')})`);
    return { confidence: Math.min(confidence, 100), reasons };
}

async function addGlobalInfractionFactor(userID, baseConfidence) {
    try {
        const globalData = await GlobalUserInfractions.findOne({ userID }).lean();
        if (!globalData) return { confidence: baseConfidence, globalCount: 0 };

        let addition = 0;
        if (globalData.infractionCount >= 8) {
            addition = 20;
        } else if (globalData.infractionCount >= 4) {
            addition = 10;
        } else if (globalData.infractionCount >= 1) {
            addition = 5;
        }

        if (addition > 0) {
            logger.debug(`[BotDetection] Added ${addition}% confidence from ${globalData.infractionCount} global infractions for user ${userID}`);
        }

        return {
            confidence: Math.min(baseConfidence + addition, 100),
            globalCount: globalData.infractionCount
        };
    } catch (error) {
        logger.error(`[BotDetection] Error fetching global infractions:`, error);
        return { confidence: baseConfidence, globalCount: 0 };
    }
}

function getActionFromConfidence(confidence, settings) {
    if (confidence < 50) {
        return { action: 'log', duration: 0 };
    }

    if (confidence >= 94.5 && settings.allowKick) {
        return { action: 'kick', duration: 0 };
    }

    if (!settings.allowTimeout) {
        return { action: 'log', duration: 0 };
    }

    if (confidence >= 90) {
        return { action: 'timeout', duration: 24 * 60 * 60 * 1000 };
    } else if (confidence >= 80) {
        return { action: 'timeout', duration: 12 * 60 * 60 * 1000 };
    } else if (confidence >= 65) {
        return { action: 'timeout', duration: 60 * 60 * 1000 };
    } else if (confidence >= 55) {
        return { action: 'timeout', duration: 30 * 60 * 1000 };
    } else {
        return { action: 'timeout', duration: 60 * 1000 };
    }
}

async function checkAltEvasion(member, serverData) {
    const result = {
        isLikelyAlt: false,
        potentialAlts: []
    };

    if (!serverData?.recentBans?.length) {
        return result;
    }

    const accountCreated = member.user.createdTimestamp;
    const joinedAt = member.joinedTimestamp || Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    for (const ban of serverData.recentBans) {
        const banTime = new Date(ban.bannedAt).getTime();
        const timeSinceBan = Date.now() - banTime;

        if (timeSinceBan > SEVEN_DAYS) continue;

        if (accountCreated > banTime) {
            result.potentialAlts.push({
                userID: ban.userID,
                bannedAt: ban.bannedAt,
                reason: 'Account created after ban'
            });
            continue;
        }

        if (joinedAt - banTime < ONE_DAY && timeSinceBan < ONE_DAY) {
            result.potentialAlts.push({
                userID: ban.userID,
                bannedAt: ban.bannedAt,
                reason: 'Joined shortly after ban'
            });
        }
    }

    if (result.potentialAlts.length > 0) {
        result.isLikelyAlt = true;
        result.potentialAlts = result.potentialAlts.filter((v, i, a) => a.findIndex(t => t.userID === v.userID) === i);
        logger.debug(`[BotDetection] Alt check for ${member.user.id}: Found ${result.potentialAlts.length} potential matches.`);
    }

    return result;
}

async function isQualifiedServer(serverData, guild) {
    try {
        if (!guild.features.includes('COMMUNITY')) {
            return false;
        }

        const stats = serverData?.memberStats;
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;

        if (stats?.lastUpdated && (now - new Date(stats.lastUpdated).getTime()) < ONE_HOUR) {
            const totalMembers = stats.totalMembers || 0;
            const botCount = stats.botCount || 0;
            const humanRatio = totalMembers > 0 ? (totalMembers - botCount) / totalMembers : 0;
            const messageCount = stats.messageCount30d || 0;

            return totalMembers >= 1000 && humanRatio >= 0.93 && messageCount >= 100;
        }

        const memberCount = guild.memberCount || 0;
        const approximateBots = guild.members.cache.filter(m => m.user.bot).size;
        const approximateHumanRatio = memberCount > 0 ? (memberCount - approximateBots) / memberCount : 0;

        return memberCount >= 1000 && approximateHumanRatio >= 0.93;
    } catch (error) {
        logger.error(`[BotDetection] Error checking server qualification:`, error);
        return false;
    }
}

async function trackGlobalInfraction(userID, serverID, serverData, guild) {
    try {
        const qualified = await isQualifiedServer(serverData, guild);
        if (!qualified) return;

        await GlobalUserInfractions.findOneAndUpdate(
            { userID },
            {
                $addToSet: { servers: serverID },
                $inc: { infractionCount: 1 },
                $set: { lastInfraction: new Date(), timestamp: new Date() }
            },
            { upsert: true }
        );
        logger.debug(`[BotDetection] Tracked global infraction for ${userID} from server ${serverID}`);
    } catch (error) {
        logger.error(`[BotDetection] Error tracking global infraction:`, error);
    }
}

async function createTracking(serverID, userID) {
    try {
        return await NewUserTracking.findOneAndUpdate(
            { serverID, userID },
            {
                $setOnInsert: {
                    serverID,
                    userID,
                    joinedAt: new Date(),
                    messageCount: 0,
                    linksSent: 0,
                    mentionCount: 0,
                    channelsUsed: [],
                    similarMessages: [],
                    analyzed: false,
                    timestamp: new Date()
                }
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        logger.error(`[BotDetection] Error creating tracking:`, error);
        return null;
    }
}

async function updateTracking(serverID, userID, messageData) {
    try {
        const update = {
            $inc: {
                messageCount: 1,
                linksSent: messageData.linksCount || 0,
                mentionCount: messageData.mentionCount || 0
            },
            $addToSet: {}
        };

        if (messageData.channelID) {
            update.$addToSet.channelsUsed = messageData.channelID;
        }

        if (messageData.contentHash) {
            update.$push = {
                similarMessages: {
                    $each: [messageData.contentHash],
                    $slice: -20
                }
            };
        }

        return await NewUserTracking.findOneAndUpdate(
            { serverID, userID, analyzed: false },
            update,
            { new: true }
        );
    } catch (error) {
        logger.error(`[BotDetection] Error updating tracking:`, error);
        return null;
    }
}

function analyzeMessageBehavior(tracking) {
    let confidence = 0;
    const reasons = [];

    if (!tracking) return { confidence: 0, reasons: [] };

    const duplicates = tracking.similarMessages?.reduce((acc, hash) => {
        acc[hash] = (acc[hash] || 0) + 1;
        return acc;
    }, {}) || {};

    const maxDuplicates = Math.max(...Object.values(duplicates), 0);
    if (maxDuplicates >= 3) {
        confidence += 25;
        reasons.push('duplicate_messages');
    }

    if (tracking.linksSent >= 3 && tracking.messageCount <= 5) {
        confidence += 20;
        reasons.push('excessive_links');
    }

    if (tracking.mentionCount >= 10) {
        confidence += 15;
        reasons.push('mass_mentions');
    }

    const channelCount = tracking.channelsUsed?.length || 0;
    const messageCount = tracking.messageCount || 0;
    if (messageCount >= 5 && channelCount === 1) {
        confidence += 5;
        reasons.push('single_channel');
    }

    const joinedAt = new Date(tracking.joinedAt).getTime();
    const timeSinceJoin = Date.now() - joinedAt;
    const messagesPerMinute = messageCount / (timeSinceJoin / 60000);
    if (messagesPerMinute > 5) {
        confidence += 15;
        reasons.push('rapid_messaging');
    }

    return { confidence: Math.min(confidence, 100), reasons };
}

async function markAnalyzed(serverID, userID) {
    try {
        return await NewUserTracking.findOneAndUpdate(
            { serverID, userID },
            { $set: { analyzed: true } }
        );
    } catch (error) {
        logger.error(`[BotDetection] Error marking analyzed:`, error);
        return null;
    }
}

function getRiskLevel(globalCount) {
    if (globalCount >= 10) return 'severe';
    if (globalCount >= 6) return 'high';
    if (globalCount >= 3) return 'moderate';
    if (globalCount >= 1) return 'low';
    return 'none';
}

async function addRecentBan(serverID, userID) {
    try {
        await Server.findOneAndUpdate(
            { serverID },
            {
                $push: {
                    recentBans: {
                        $each: [{ userID, bannedAt: new Date() }],
                        $slice: -10
                    }
                }
            }
        );
    } catch (error) {
        logger.error(`[BotDetection] Error adding recent ban:`, error);
    }
}

function extractLinks(content) {
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    return content.match(urlRegex) || [];
}

function isLinkTrusted(url) {
    try {
        const urlObj = new URL(url);
        if (urlObj.protocol === 'http:') return false;
        const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
        return TRUSTED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    } catch {
        return false;
    }
}

function trackLinkMessage(serverID, userID, channelID, messageID, links) {
    const key = `${serverID}:${userID}`;
    const now = Date.now();

    if (!linkSpamTracker.has(key)) {
        linkSpamTracker.set(key, []);
    }

    const tracker = linkSpamTracker.get(key);
    tracker.push({
        channelID,
        messageID,
        links,
        timestamp: now
    });

    const TWO_MINUTES = 120 * 1000;
    const filtered = tracker.filter(entry => (now - entry.timestamp) < TWO_MINUTES);
    linkSpamTracker.set(key, filtered);

    setTimeout(() => {
        const current = linkSpamTracker.get(key);
        if (current) {
            const stillValid = current.filter(e => (Date.now() - e.timestamp) < TWO_MINUTES);
            if (stillValid.length === 0) {
                linkSpamTracker.delete(key);
            } else {
                linkSpamTracker.set(key, stillValid);
            }
        }
    }, TWO_MINUTES + 1000);

    return filtered;
}

async function checkCrossChannelLinkSpam(message, settings) {
    if (!settings?.enabled || !settings?.checks?.messageBehavior) {
        return { isSpam: false };
    }

    const links = extractLinks(message.content);
    const hasAttachments = message.attachments.size > 0;

    if (links.length === 0 && !hasAttachments) {
        return { isSpam: false };
    }

    const trackedItems = [...links];
    if (hasAttachments) trackedItems.push('attachment');

    const tracked = trackLinkMessage(
        message.guild.id,
        message.author.id,
        message.channel.id,
        message.id,
        trackedItems
    );

    const uniqueChannels = new Set(tracked.map(e => e.channelID));

    if (uniqueChannels.size >= 2) {
        const allMessageIDs = tracked.map(e => ({ channelID: e.channelID, messageID: e.messageID }));
        const allLinks = tracked.flatMap(e => e.links);

        linkSpamTracker.delete(`${message.guild.id}:${message.author.id}`);

        const spamResult = {
            isSpam: true,
            channelCount: uniqueChannels.size,
            messageCount: tracked.length,
            messages: allMessageIDs,
            links: [...new Set(allLinks)],
            reasons: ['cross_channel_spam', `${uniqueChannels.size}_channels_within_2min`, hasAttachments ? 'attachments_detected' : 'links_detected']
        };

        logger.debug(`[BotDetection] Detected cross-channel spam for ${message.author.id}: ${uniqueChannels.size} channels, ${tracked.length} messages`);
        return spamResult;
    }

    return { isSpam: false };
}
//
module.exports = {
    getSettings,
    saveSettings,
    calculateConfidence,
    addGlobalInfractionFactor,
    getActionFromConfidence,
    checkAltEvasion,
    isQualifiedServer,
    trackGlobalInfraction,
    createTracking,
    updateTracking,
    analyzeMessageBehavior,
    markAnalyzed,
    getRiskLevel,
    addRecentBan,
    extractLinks,
    isLinkTrusted,
    checkCrossChannelLinkSpam
};


// contributors: @relentiousdragon