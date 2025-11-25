const mongoose = require("mongoose");
//
const userSchema = mongoose.Schema({
    userID: { type: String, unique: true, required: true },
    lastActive: { type: Date, default: Date.now },
    lastVote: { type: Date, default: null },
    lastVoteClaim: { type: Date, default: null },
    mail: [{
        title: String,
        message: String,
        thumbnail: { type: String, default: null },
        expiry: Date,
        read: Boolean,
        color: Number
    }],
    read_global_mails: [String],
    preferences: {
        "bar": { type: String, default: null },
        "stored_bars": [String],
        "color": { type: String, default: null },
        "divider": { type: String, default: null },
    },
    banned: { type: Boolean, default: false }
}, { versionKey: false });

module.exports = mongoose.model("users", userSchema);