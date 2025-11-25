const mongoose = require("mongoose");
//
const globalMailSchema = mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    thumbnail: { type: String, default: null },
    expiry: { type: Date, required: true },
    color: { type: Number, default: 0x3498DB },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model("global_mails", globalMailSchema);
