const mongoose = require("mongoose");

const shardHistorySchema = mongoose.Schema({
    shardID: { type: Number, required: true, index: true },
    guildCount: { type: Number, required: true },
    userCount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

shardHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2764800 });

module.exports = mongoose.model("shardHistory", shardHistorySchema);
