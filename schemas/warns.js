const mongoose = require("mongoose");
//
const warnSchema = mongoose.Schema({
    serverID: { type: String, required: true, index: true },
    userID: { type: String, required: true, index: true },
    warns: [{
        id: { type: String, required: true },
        reason: { type: String, required: true },
        moderator: {
            id: { type: String, required: true },
            tag: { type: String, required: true }
        },
        timestamp: { type: Date, default: Date.now, index: true }
    }]
}, { versionKey: false });

warnSchema.index({ serverID: 1, userID: 1 });



module.exports = mongoose.model("warns", warnSchema);
