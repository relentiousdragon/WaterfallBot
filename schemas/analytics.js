const mongoose = require("mongoose");
//
const analyticsSchema = new mongoose.Schema({
    timestamp: { type: Date, required: true },
    messages: { type: Number, default: 0 },
    interactions: { type: Number, default: 0 },
    commandsUsage: { type: Map, of: Number, default: {} },
    rpsWaterfallWins: { type: Number, default: 0 },
    rpsHumanWins: { type: Number, default: 0 },
    connect4WaterfallWins: { type: Number, default: 0 },
    connect4HumanWins: { type: Number, default: 0 }
});

analyticsSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model("Analytics", analyticsSchema);
