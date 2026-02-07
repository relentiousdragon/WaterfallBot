const mongoose = require("mongoose");
//
const serverSchema = mongoose.Schema({
    serverID: { type: String, index: true },
    prefix: String,
    language: { type: String, default: "en" },
    botProfile: { type: String, default: "default" },
    botProfileLastUpdate: { type: Number, default: 0 },
    lastWelcomeMessage: { type: Number, default: 0 },
    serverStatsOverviewLastUpdate: { type: Number, default: 0 },
    serverStatsActivityLastUpdate: { type: Number, default: 0 },
    banned: { type: Boolean, default: false },
    logs: {
        messages: { channelId: String, webhook: [String] },
        members: { channelId: String, webhook: [String] },
        moderation: { channelId: String, webhook: [String] },
        channels: { channelId: String, webhook: [String] },
        expressions: { channelId: String, webhook: [String] },
        invites: { channelId: String, webhook: [String] },
        roles: { channelId: String, webhook: [String] },
        ignoreBots: { type: Boolean, default: true }
    },
    warnThresholds: {
        type: Map,
        of: {
            action: { type: String, enum: ['none', 'timeout', 'kick', 'ban'], default: 'timeout' },
            duration: { type: Number, default: 0 }
        },
        default: () => new Map([
            ['2', { action: 'timeout', duration: 1800000 }],      // 30 minute
            ['3', { action: 'timeout', duration: 86400000 }],     // 1 day
            ['5', { action: 'timeout', duration: 604800000 }]     // 1 week
        ])
    },
    serverStats: {
        enabled: { type: Boolean, default: false },
        excludedChannels: [String]
    },
    recentBans: [{
        userID: String,
        bannedAt: { type: Date, default: Date.now }
    }],
    memberStats: {
        totalMembers: { type: Number, default: 0 },
        botCount: { type: Number, default: 0 },
        messageCount30d: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: null }
    },
    pendingDeletion: { type: Date, default: null }
}, { versionKey: false });

serverSchema.index({ banned: 1 });
serverSchema.index({ pendingDeletion: 1 });

module.exports = {
    Server: mongoose.model("servers", serverSchema)
};


// contributors: @relentiousdragon