const Discord = require("discord.js");
const { millify } = require("millify");
const axios = require("axios");
const { loadImage } = require("canvas");
const logger = require("../logger.js");
const he = require('he');
let _dmQueue = [];
let _dmActive = 0;
const DM_CONCURRENCY = 10;

async function _processDMQueue() {
    while (_dmActive < DM_CONCURRENCY && _dmQueue.length) {
        const item = _dmQueue.shift();
        _dmActive++;
        (async () => {
            try {
                const discordUser = await item.bot.users.fetch(item.userId).catch(() => null);
                if (!discordUser) return item.resolve({ ok: false, err: new Error('User not found') });
                const res = await discordUser.send(item.payload);
                item.resolve({ ok: true, res });
            } catch (err) {
                item.resolve({ ok: false, err });
            } finally {
                _dmActive--;
                setImmediate(_processDMQueue);
            }
        })();
    }
}
//
module.exports = {
    /**
     * @param {string} bet - bet to check
     * @returns {boolean} Result
     */
    bet_check: function (bet) {
        if (bet.startsWith("-")) return false;
        if (isNaN(bet)) return false;
        if (bet.includes(".")) return false;
        if (bet.includes("Infinity")) return false;
        return true;
    },
    /**
     * @param {number} cost - cost of item
     * @param {number} amount - amount of item
     * @returns {number} calculated cost
     */
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
    /**
     * @param {number} number - number to abbreviate
     * @param {number} threshold - threshold for abbreviation
     * @returns {string} abbreviated number
     */
    abbr: function formatNumber(number, threshold = 1e8) {
        if (number < threshold) {
            return number.toLocaleString();
        } else {
            return millify(number, { precision: 2, lowercase: true });
        }
    },
    /**
     * @param {number} currentVal - current value
     * @param {number} MaxValue - max value
     * @param {number} MaxBars - max bars, default: 3
     * @param {string} color - color, default: YELLOW
     * @returns {string} progress bar
     */
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
    /**
     * @param {string} emojiString - discord emoji markdown string
     * @returns {object} emoji object: name, id
     */
    parseEmoji: function (emojiString) {
        if (!emojiString) return null;
        if (typeof emojiString === 'object' && emojiString.__isEmoji) {
            emojiString = emojiString.__v;
        }
        const match = emojiString.match(/<a?:(\w+):(\d+)>/);
        if (match) {
            return { name: match[1], id: match[2] };
        }
        return emojiString;
    },
    /**
     * @param {number} ms - milliseconds to sleep
     * @returns {Promise} Promise that resolves after ms milliseconds
     */
    sleep: function (ms) {
        return new Promise(res => setTimeout(res, ms));
    },
    /**
     * @param {string} str - string to parse
     * @returns {number} parsed number
     */
    parseAbbr: function (str) {
        if (!str || typeof str !== 'string') return 0;
        const s = str.toLowerCase().replace(/,/g, '').trim();
        if (!s) return 0;

        const maxCap = 1e50;
        const suffixes = {
            'k': 1e3, 'm': 1e6, 'b': 1e9, 't': 1e12, 'q': 1e15,
            'sx': 1e18, 'sp': 1e21, 'o': 1e24, 'n': 1e27, 'd': 1e30,
            'h': 1e2
        };

        const regex = /([0-9.]+)([a-z]*)/g;
        let total = 0;
        let match;
        let hasMatch = false;

        while ((match = regex.exec(s)) !== null) {
            const val = parseFloat(match[1]);
            const suffix = match[2];
            if (!isNaN(val)) {
                total += val * (suffixes[suffix] || 1);
                hasMatch = true;
            }
        }

        if (!hasMatch) return 0;
        return Math.min(total, maxCap);
    },
    /**
     * @param {string} text - text to decode
     * @param {string} domain - domain the text is from, optional
     * @returns {string} decoded text
     */
    decodeHtmlEntities: function (text, domain = '') {
        if (!text) return text;

        text = he.decode(text);

        text = text
            .replace(/<\/?b>/gi, '**')
            .replace(/<\/?strong>/gi, '**')
            .replace(/<\/?i>/gi, '*')
            .replace(/<\/?em>/gi, '*')
            .replace(/<\/p>/gi, '')
            .replace(/<p[^>]*>/gi, '-# ')
            .replace(/<br\s*\/?>/gi, '\n');

        text = text.replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, linkText) => {
            if (/^https?:\/\//i.test(href)) {
                return `[${linkText}](${href})`;
            } else if (domain) {
                const url = domain.replace(/\/$/, '') + '/' + href.replace(/^\//, '');
                return `[${linkText}](${url})`;
            } else {
                return linkText;
            }
        });

        return text;
    },
    /**
    * @param {string} text - text to truncate
    * @param {number} max - max length of text, default 1024
    * @returns {string} Result
    */
    truncate: function (text, max = 1024) {
        if (!text) return '—';
        if (text.length <= max) return text;
        return text.slice(0, max - 3) + '...';
    },
    /**
    * @param {string} query - text to filter
    * @returns {string} Result, [REDACTED] if api fails
    */
    async filterString(query) {
        try {
            const response = await axios.get('https://www.purgomalum.com/service/json', {
                params: { text: query, fill_char: '-' }
            });
            return response.data.result || '[REDACTED]';
        } catch {
            return '[REDACTED]';
        }
    },
    /**
    * @param {string} domain - domain name
    * @returns {string} Result
    */
    async getLogoUrl(domain) {
        return `https://logo.clearbit.com/${domain}`;
    },
    /**
    * @param {string} url - image url
    * @param {number} timeout - in ms (default 2s)
    * @returns {boolean} Result
    */
    async isImageUrl(url, timeout = 2000) {
        if (!url) return false;
        const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            if (imageExtensions.some(ext => pathname.endsWith(ext))) return true;
        } catch { }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
            clearTimeout(timeoutId);
            let contentType = response.headers.get('content-type');
            if (!contentType) return imageExtensions.some(ext => url.toLowerCase().includes(ext));
            return contentType.startsWith('image/');
        } catch {
            return imageExtensions.some(ext => url.toLowerCase().includes(ext));
        }
    },
    /**
    * @param {string} url - image url
    * @returns {{isValid: boolean, width: number, height: number, ratio: number}} Result
    */
    async getImageInfo(url) {
        if (!url) return { isValid: false };
        try {
            const img = await loadImage(url);
            return {
                isValid: true,
                width: img.width,
                height: img.height,
                ratio: img.width / img.height
            };
        } catch (err) {
            return { isValid: false };
        }
    },
    /**
    * @param {object} infractions - infractions array
    * @returns {object} Result
    */
    getRiskTier: function (infractions = []) {
        const tiers = [
            { level: 1, name: "Clear", color: "#2ecc71" },
            { level: 2, name: "Low Risk", color: "#f1c40f" },
            { level: 3, name: "Moderate Risk", color: "#e67e22" },
            { level: 4, name: "Repeat Offender", color: "#e74c3c" },
            { level: 5, name: "Extreme Risk", color: "#9b59b6" }
        ];

        const fortyFiveDaysAgo = Date.now() - (45 * 24 * 60 * 60 * 1000);
        const recentInfractions = infractions.filter(inf => new Date(inf.timestamp).getTime() > fortyFiveDaysAgo).length;

        let tier;
        if (recentInfractions === 0) tier = tiers[0];
        else if (recentInfractions <= 2) tier = tiers[1];
        else if (recentInfractions <= 5) tier = tiers[2];
        else if (recentInfractions <= 7) tier = tiers[3];
        else tier = tiers[4];

        return { ...tier, count: recentInfractions };
    },
    /**
     * @param {string} str - duration string, example: "1h 30s"
     * @returns {number} duration in milliseconds
     */
    parseDuration: function (str) {
        if (!str) return null;
        const units = {
            's': 1000,
            'm': 1000 * 60,
            'h': 1000 * 60 * 60,
            'd': 1000 * 60 * 60 * 24,
            'w': 1000 * 60 * 60 * 24 * 7,
            'mo': 1000 * 60 * 60 * 24 * 30,
            'y': 1000 * 60 * 60 * 24 * 365,
        };

        const regex = /(\d+)\s*(mo|y|w|d|h|m|s)/gi;
        let totalMs = 0;
        let match;
        let hasMatch = false;

        while ((match = regex.exec(str)) !== null) {
            const value = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            if (units[unit]) {
                totalMs += value * units[unit];
                hasMatch = true;
            }
        }

        if (!hasMatch && /^\d+$/.test(str.trim())) {
            totalMs = parseInt(str.trim()) * 1000 * 60;
            hasMatch = true;
        }

        return hasMatch ? totalMs : null;
    },
    /**
    * @param {string} ms - milliseconds
    * @param {object} options - maxUnit, excludeWeeks
    * @returns {string} Result
    */
    formatDurationPretty: function (ms, options = {}) {
        const { maxUnit = 'y', excludeWeeks = true } = options;

        const UNIT_VALUES = {
            y: 1000 * 60 * 60 * 24 * 365,
            mo: 1000 * 60 * 60 * 24 * 30,
            w: 1000 * 60 * 60 * 24 * 7,
            d: 1000 * 60 * 60 * 24,
            h: 1000 * 60 * 60,
            m: 1000 * 60,
            s: 1000,
        };

        const unitOrder = ['y', 'mo', 'w', 'd', 'h', 'm', 's'];
        let filteredUnits = unitOrder;

        if (excludeWeeks) {
            filteredUnits = filteredUnits.filter(u => u !== 'w');
        }

        const maxIndex = filteredUnits.indexOf(maxUnit);
        if (maxIndex !== -1) {
            filteredUnits = filteredUnits.slice(maxIndex);
        }

        let remaining = ms;
        const durationObj = {};
        const activeUnits = [];

        for (const unit of filteredUnits) {
            const val = UNIT_VALUES[unit];
            if (unit === filteredUnits[0]) {
                const amount = Math.floor(remaining / val);
                if (amount > 0 || unit === filteredUnits[filteredUnits.length - 1]) {
                    const key = unit === 'mo' ? 'months' : unit === 'y' ? 'years' : unit === 'w' ? 'weeks' : unit === 'd' ? 'days' : unit === 'h' ? 'hours' : unit === 'm' ? 'minutes' : 'seconds';
                    durationObj[key] = amount;
                    activeUnits.push(unit);
                    remaining %= val;
                }
            } else {
                const amount = Math.floor(remaining / val);
                if (amount > 0) {
                    const key = unit === 'mo' ? 'months' : unit === 'y' ? 'years' : unit === 'w' ? 'weeks' : unit === 'd' ? 'days' : unit === 'h' ? 'hours' : unit === 'm' ? 'minutes' : 'seconds';
                    durationObj[key] = amount;
                    activeUnits.push(unit);
                    remaining %= val;
                }
            }
            if (activeUnits.length >= 2) break;
        }

        if (typeof Intl.DurationFormat !== 'undefined') {
            try {
                const formatter = new Intl.DurationFormat('en-US', {
                    style: 'narrow',
                    years: 'narrow',
                    months: 'narrow',
                    weeks: 'narrow',
                    days: 'narrow',
                    hours: 'narrow',
                    minutes: 'narrow',
                    seconds: 'narrow'
                });
                return formatter.format(durationObj).replace(/,/g, '');
            } catch (e) { }
        }

        const parts = activeUnits.map(unit => {
            const key = unit === 'mo' ? 'months' : unit === 'y' ? 'years' : unit === 'w' ? 'weeks' : unit === 'd' ? 'days' : unit === 'h' ? 'hours' : unit === 'm' ? 'minutes' : 'seconds';
            return `${durationObj[key].toLocaleString()}${unit}`;
        });

        return parts.join(' ') || '0s';
    },
    /**
    * @param {string} url
    * @returns {{safe: boolean, reason: string}} Result
    */
    async checkUrlSafety(url) {
        if (!url) return { safe: true };
        const knownGrabbers = [
            'grabify.link', 'grabify.com', 'grabify.org', 'blasze.com', 'iplogger.org',
            'location.cyou', 'mymap.icu', 'mymap.quest', 'map-s.online', 'crypto-o.click',
            'cryp-o.online', 'account.beauty', 'photospace.life', 'photovault.store',
            'imagehub.fun', 'sharevault.cloud', 'xtube.chat', 'screensnaps.top',
            'foot.wiki', 'screenshare.pics', 'myprivate.pics', 'shrekis.life',
            'screenshot.best', 'gamingfun.me', 'stopify.co'
        ];

        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
            if (knownGrabbers.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
                return { safe: false, reason: 'Known IP grabbing domain detected' };
            }
        } catch (e) { }

        const apiKey = process.env.GOOGLE_API_KEY2;
        if (!apiKey) return { safe: true };

        try {
            const response = await axios.post(
                `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
                {
                    client: {
                        clientId: "waterfall-bot",
                        clientVersion: "1.2.2"
                    },
                    threatInfo: {
                        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                        platformTypes: ["ANY_PLATFORM"],
                        threatEntryTypes: ["URL"],
                        threatEntries: [{ url: url }]
                    }
                }
            );

            if (response.data && response.data.matches && response.data.matches.length > 0) {
                const threatType = response.data.matches[0].threatType;
                return { safe: false, reason: threatType.replace(/_/g, ' ').toLowerCase() };
            }

            return { safe: true };
        } catch (err) {
            logger.error(`[UrlSafety] API check failed: ${err.message}`);
            if (err.response && err.response.status === 403) {
                return { safe: true, error: 403 };
            }
            return { safe: true };
        }
    },
sendDM: function (bot, userId, payload) {
        return new Promise(resolve => {
            _dmQueue.push({ bot, userId, payload, resolve });
            _processDMQueue();
        });
    }
};


// contributors: @relentiousdragon