const mongoose = require("mongoose");

const shardHistorySchema = mongoose.Schema({
    shardID: { type: Number, required: true, index: true },
    guildCount: { type: Number, required: true },
    userCount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, index: { expireAfterSeconds: 2764800 } }
}, { versionKey: false });


module.exports = mongoose.model("shardHistory", shardHistorySchema);
