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
        notifications: {
            vote: { type: String, default: "OFF" }, // OFF, DM, INTERACTION
            voteThanks: { type: String, default: "DM" }, // OFF, DM
            voteNotice: { type: Boolean, default: false }
        }
    },
    voteReminderSent: { type: Boolean, default: true },
    locale: { type: String, default: 'en' },
    geminiImageUsage: {
        date: { type: String, default: null },
        count: { type: Number, default: 0 }
    },
    banned: { type: Boolean, default: false }
}, { versionKey: false });

userSchema.index({ banned: 1 });

module.exports = mongoose.model("users", userSchema);


// contributors: @relentiousdragon