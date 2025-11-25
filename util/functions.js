const Discord = require("discord.js");
const { millify } = require("millify");
const axios = require("axios");
const logger = require("../logger.js");
async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
//
module.exports = {
    bet_check: function (bet) {
        if (bet.startsWith("-")) return false;
        if (isNaN(bet)) return false;
        if (bet.includes(".")) return false;
        if (bet.includes("Infinity")) return false;
    },
    costCalc(cost, amount) {
        //var amountT = amount + 1;
        //var amountTotal = amountT * amountT;
        //var total = amountTotal * cost;
        const scalingFactor = 1.7;
        var total = cost * Math.pow(amount + 1, scalingFactor);
        total = Math.round(total / 100) * 100;
        return Math.max(total, 100);
        //return total;
    },
    abbr: function formatNumber(number) {
        if (number < 1e6) {
            return number.toLocaleString();
        } else {
            return millify(number, { precision: 2, lowercase: true });
        }
    },
    progressBar: function (currentVal, MaxValue, MaxBars = 3, color = "YELLOW") {
        // WIP
        const emojis = {
            CYAN: { start: "<:B11:1304820613537337344>", half: "<:B012:1304820637419835502>", mid: "<:B12:1304820657430990959>", end: "<:B13:1304820677936807998>" },
            STANDARD: { start: "<:S01:1304820481479802991>", half: "<:S02:1304820503994826782>", mid: "<:S02:1304820503994826782>", end: "<:S03:1304820521334079498>" }
        };

        if (currentVal == 0) {
            let emptyBar = (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.start : emojis.STANDARD.start);
            for (let i = 1; i < MaxBars - 1; i++) {
                emptyBar += (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.mid : emojis.STANDARD.mid);
            }
            emptyBar += (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.end : emojis.STANDARD.end);
            return emptyBar;
        }

        const ratio = currentVal / MaxValue;
        const filledBars = Math.floor(ratio * MaxBars);
        const halfBarNeeded = currentVal < MaxValue;

        let progressBar = "";
        const chosenEmojis = emojis[color.toUpperCase()] || emojis.CYAN;

        if (filledBars > 0) {
            progressBar += chosenEmojis.start;
        }

        if (halfBarNeeded) {
            if (filledBars === 0) {
                progressBar += chosenEmojis.start;
            }
        }

        for (let i = 1; i < filledBars; i++) {
            progressBar += chosenEmojis.mid;
        }

        const emptyBars = MaxBars - filledBars - (halfBarNeeded ? 1 : 0);

        if (halfBarNeeded) {
            progressBar += chosenEmojis.half;
        }
        for (let i = 1; i < emptyBars; i++) {
            progressBar += (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.mid : emojis.STANDARD.mid);
        }

        if (emptyBars > 0 && !halfBarNeeded) {
            progressBar += (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.end : emojis.STANDARD.end);
        } else if (!halfBarNeeded) {
            progressBar += chosenEmojis.end;
        } else {
            progressBar += (color.toUpperCase() == "GECKO" ? emojis.GECKO_STANDARD.end : emojis.STANDARD.end);
        }

        return progressBar;
    },
    parseEmoji: function (emojiString) {
        if (!emojiString) return null;
        const match = emojiString.match(/<a?:(\w+):(\d+)>/);
        if (match) {
            return { name: match[1], id: match[2] };
        }
        return emojiString;
    }
};