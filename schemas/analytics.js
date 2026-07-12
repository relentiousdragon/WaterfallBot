const mongoose = require("mongoose");
//
const analyticsSchema = new mongoose.Schema({
    timestamp: { type: Date, required: true, index: { expireAfterSeconds: 2764800 } },
    messages: { type: Number, default: 0 },
    interactions: { type: Number, default: 0 },
    commandsUsage: { type: Map, of: Number, default: {} },
    rpsWaterfallWins: { type: Number, default: 0 },
    rpsHumanWins: { type: Number, default: 0 },
    connect4WaterfallWins: { type: Number, default: 0 },
    connect4HumanWins: { type: Number, default: 0 }
});



module.exports = mongoose.model("Analytics", analyticsSchema);


// contributors: @relentiousdragon