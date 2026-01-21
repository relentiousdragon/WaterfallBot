const fs = require("fs");
const path = require("path");
const pino = require("pino");
const { AsyncLocalStorage } = require("async_hooks");
const settings = require("./util/settings.json");
const fetch = require("node-fetch");
const pinoPretty = require('pino-pretty');
const chalk = require("chalk");

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const MAX_LOG_AGE_DAYS = 14;
async function cleanOldLogs() {
    try {
        const now = Date.now();
        const files = await fs.promises.readdir(LOG_DIR);
        for (const file of files) {
            const filePath = path.join(LOG_DIR, file);
            const stats = await fs.promises.stat(filePath);
            const ageDays = (now - stats.mtimeMs) / (86400 * 1000);
            if (ageDays > MAX_LOG_AGE_DAYS) {
                await fs.promises.unlink(filePath);
            }
        }
    } catch (err) {
        console.error("Failed to clean old logs:", err);
    }
}
cleanOldLogs();

const contextStorage = new AsyncLocalStorage();

const logLevel = (settings.debug === 'true' || settings.debug === true) ? 'debug' : 'info';
console.log(`[Logger] Configured with level: ${logLevel}`);

const streams = [
    {
        level: logLevel,
        stream: pinoPretty({
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            messageFormat: (log, messageKey) => {
                const msg = log[messageKey];
                const level = log.level;
                if (level >= 60) return chalk.bgRed.white.bold(msg);
                if (level >= 50) return chalk.redBright(msg);
                if (level >= 40) return chalk.yellowBright(msg);
                if (level >= 30) {
                    if (msg.includes("[SUCCESS]")) return chalk.hex('#4ADE80')(msg);
                    return chalk.blueBright(msg);
                }
                return msg;
            }
        })
    },
    { level: logLevel, stream: pino.destination(path.join(LOG_DIR, "combined.log")) },
    { level: 'error', stream: pino.destination(path.join(LOG_DIR, "error.log")) }
];

const pinoLogger = pino({
    level: logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream(streams));

function getContext() {
    return contextStorage.getStore() || {};
}

function getContextMsg(msg) {
    const ctx = getContext();
    const parts = [];
    if (ctx.guildId) parts.push(`Guild: ${ctx.guildId}`);
    if (ctx.userId) parts.push(`User: ${ctx.userId}`);
    if (ctx.command) parts.push(`Cmd: ${ctx.command}`);
    if (parts.length > 0) {
        return `[${parts.join(' | ')}] ${msg}`;
    }
    return msg;
}

function buildWebhookURL(arr) {
    if (!arr || !arr[0] || !arr[1]) return null;
    return `https://discord.com/api/webhooks/${arr[0]}/${arr[1]}`;
}
const webhookFatal = buildWebhookURL(settings.logWebhook2);

async function sendWebhookImmediate(url, message, level = "INFO", options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const isCanary = process.env.CANARY === 'true';
    const titlePrefix = isCanary ? "YSCHIT MOM" : "BALD";
    const footerText = isCanary ? "CANARY" : `Shard ${process.env.SHARD_ID || 0}`;

    let color = 0x3B82F6;
    if (level === "FATAL") color = 0xFF5555;
    else if (level === "ERROR") color = 0xFF6B6B;
    else if (level === "WARN") color = 0xFACC15;
    else if (level === "SUCCESS") color = 0x4ADE80;

    const body = {
        username: "Waterfall",
        embeds: [{
            title: `${titlePrefix}: ${level}`,
            description: `\`\`\`diff\n${message}\n\`\`\``,
            color: color,
            timestamp: new Date().toISOString(),
            footer: { text: footerText }
        }]
    };

    if (options.silent) {
        body.flags = 4096;
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}
//
const logger = {
    info: (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(" ");
        pinoLogger.info(getContextMsg(msg));
    },

    warn: (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(" ");
        pinoLogger.warn(getContextMsg(msg));
    },

    error: (...args) => {
        const msg = args.map(a => {
            if (a instanceof Error) return `${a.message}\n${a.stack}`;
            return typeof a === 'object' ? JSON.stringify(a) : a;
        }).join(" ");
        pinoLogger.error(getContextMsg(msg));
    },

    fatal: (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(" ");
        pinoLogger.fatal(getContextMsg(msg));
        logger.alertSync(msg, "FATAL", { silent: false });
    },

    debug: (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(" ");
        pinoLogger.debug(getContextMsg(msg));
    },

    neon: (msg) => {
        const out = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
        const colored = out.split("\n").map(line => `\x1b[95m${line}\x1b[0m`).join("\n");
        console.log(colored);
    },
    gradient: (msg) => {
        const str = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
        const colors = ["31", "33", "32", "36", "34", "35"];
        const chars = str.split("");
        let out = chars.map((c, i) => `\x1b[${colors[i % colors.length]}m${c}\x1b[0m`).join("");
        console.log(out);
    },
    bigSuccess: (msg) => {
        const out = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
        pinoLogger.info(`[SUCCESS] ${out}`);
        const border = "========================================";
        const coloredLines = `\n${border}\n${out.split('\n').map(l => `   ${l}   `).join('\n')}\n${border}`.split('\n').map(l => `\x1b[32m${l}\x1b[0m`).join('\n');
        console.log(`\n${coloredLines}\n`);
        logger.alertSync(out, "SUCCESS");
    },

    warnAlert: (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(" ");
        logger.warn(msg);
        logger.alertSync(msg, "WARN", { silent: false });
    },

    alert: (msg, level = "INFO", options = {}) => {
        logger.alertSync(msg, level, { silent: false, ...options });
    },

    silentAlert: (msg, level = "INFO") => {
        logger.alertSync(msg, level, { silent: true });
    },

    alertSync: async (msg, level = "INFO", options = {}) => {
        if (!webhookFatal) return;
        const out = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
        try {
            const finalOptions = { silent: true, ...options };
            await sendWebhookImmediate(webhookFatal, out, level, finalOptions);
        } catch (err) {
            console.error("webhook failed:", err.message);
        }
    },
    runWithContext: (ctx, callback) => {
        const store = { ...ctx, timestamp: Date.now() };
        return contextStorage.run(store, callback);
    },
    getContext: getContext,
};
//
module.exports = logger;


// contributors: @relentiousdragon