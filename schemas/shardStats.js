const mongoose = require("mongoose");
//
const shardStatsSchema = mongoose.Schema({
    shardID: { type: Number, required: true, unique: true, index: true },

    guildCount: { type: Number, default: 0 },
    userCount: { type: Number, default: 0 },
    wsPing: { type: Number, default: null },

    memory: {
        rss: { type: Number, default: 0 },
        heapUsed: { type: Number, default: 0 }
    },

    uptimeSeconds: { type: Number, default: 0 },

    crashed: { type: Boolean, default: false },
    lastCrash: { type: Date, default: null },

    updatedAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

module.exports = mongoose.model("shardStats", shardStatsSchema);


// contributors: @relentiousdragon
