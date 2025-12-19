const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const fetch = require("node-fetch");
const settings = require("./util/settings.json");

const LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const combinedLogStream = fs.createWriteStream(path.join(LOG_DIR, "combined.log"), { flags: "a" });
const errorLogStream = fs.createWriteStream(path.join(LOG_DIR, "error.log"), { flags: "a" });

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

function ts() {
    return new Date().toLocaleString();
}

function writeToStream(stream, msg) {
    if (stream.writable) {
        stream.write(msg + "\n");
    }
}

const levelColors = {
    info: chalk.blueBright,
    warn: chalk.yellowBright,
    error: chalk.redBright,
    debug: chalk.cyanBright,
    fatal: chalk.bgRed.white.bold
};

let currentContext = {};
const contextStack = [];

function setContext(ctx) {
    if (Object.keys(currentContext).length > 0) {
        contextStack.push({ ...currentContext });
    }
    currentContext = { ...ctx, timestamp: Date.now() };
}

function clearContext() {
    if (contextStack.length > 0) {
        currentContext = contextStack.pop();
    } else {
        currentContext = {};
    }
}

function getContext() {
    return { ...currentContext };
}

function formatContext(ctx) {
    const parts = [];
    if (ctx.guildId) parts.push(`Guild: ${ctx.guildId}`);
    if (ctx.userId) parts.push(`User: ${ctx.userId}`);
    if (ctx.command) parts.push(`Command: ${ctx.command}`);
    if (ctx.action) parts.push(`Action: ${ctx.action}`);
    if (ctx.channelId) parts.push(`Channel: ${ctx.channelId}`);
    return parts.length > 0 ? `[${parts.join(' | ')}]` : '';
}

function extractDiscordErrorCode(error) {
    if (!error) return null;

    if (error.code) return error.code;
    if (error.httpStatus) return `HTTP ${error.httpStatus}`;
    if (error.status) return `HTTP ${error.status}`;

    if (error.rawError?.code) return error.rawError.code;

    return null;
}

function buildWebhookURL(arr) {
    if (!arr || !arr[0] || !arr[1]) return null;
    return `https://discord.com/api/webhooks/${arr[0]}/${arr[1]}`;
}

const webhookFatal = buildWebhookURL(settings.logWebhook2);

async function sendWebhookImmediate(url, message, level = "INFO") {
    const truncated = truncate(flattenMessage(message));
    const diffMessage = formatDiffMessage(level, truncated);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const isCanary = process.env.CANARY === 'true';
    const titlePrefix = isCanary ? "YSCHIT MOM" : "BALD";
    const footerText = isCanary ? "CANARY" : `Shard ${process.env.SHARD_ID || 0}`;

    let color;
    if (isCanary) {
        color = level === "FATAL" ? 0x8B0000 :
            level === "ERROR" ? 0xB22222 :
                level === "SUCCESS" ? 0x228B22 :
                    level === "WARN" ? 0xDAA520 :
                        level === "INFO" ? 0x4682B4 :
                            0x5F9EA0;
    } else {
        color = level === "FATAL" ? 0xFF5555 :
            level === "ERROR" ? 0xFF6B6B :
                level === "SUCCESS" ? 0x4ADE80 :
                    level === "WARN" ? 0xFACC15 :
                        level === "INFO" ? 0x3B82F6 :
                            0x60A5FA;
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "Waterfall",
                embeds: [
                    {
                        title: `${titlePrefix}: ${level}`,
                        description: diffMessage,
                        color: color,
                        timestamp: new Date().toISOString(),
                        footer: { text: footerText }
                    }
                ]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    } finally {
        clearTimeout(timeout);
    }
}

function flattenMessage(msg) {
    if (typeof msg !== "string") return String(msg);
    return msg.replace(/\n/g, " | ");
}

function truncate(str, len = 4000) {
    return str.length > len ? str.slice(0, len) + "... [truncated]" : str;
}

function formatDiffMessage(level, message) {
    const code = "```diff\n";
    if (level === "ERROR" || level === "FATAL") return `${code}- ${message}\n\`\`\``;
    if (level === "SUCCESS") return `${code}+ ${message}\n\`\`\``;
    if (level === "WARN") return `${code}! ${message}\n\`\`\``;
    return `${code}# ${message}\n\`\`\``;
}

function extractRelevantStackInfo(stack, maxFiles = 5) {
    if (!stack) return "No stack trace";

    const lines = stack.split('\n').slice(1);
    const relevantLines = [];

    for (const line of lines) {
        const match = line.match(/at (.+?) \((.+):(\d+):(\d+)\)/) || line.match(/at (.+):(\d+):(\d+)/);
        if (match) {
            const filePath = match[2] || match[1];
            const lineNumber = match[3] || match[2];

            const relativePath = filePath.includes(__dirname)
                ? filePath.replace(__dirname + path.sep, '')
                : filePath;

            relevantLines.push(`  at ${relativePath}:${lineNumber}`);

            if (relevantLines.length >= maxFiles) break;
        }
    }

    if (relevantLines.length === 0) {
        return stack;
    }

    return relevantLines.join('\n');
}

function formatValidationError(error) {
    let message = error.message || 'Validation Error';
    const validationInfo = [];

    if (error.validator) validationInfo.push(`Validator: ${error.validator}`);
    if (error.expected) validationInfo.push(`Expected: ${error.expected}`);
    if (error.given !== undefined) validationInfo.push(`Received: ${JSON.stringify(error.given)}`);

    if (error.errors && Array.isArray(error.errors)) {
        validationInfo.push('Detailed Issues:');

        error.errors.forEach((e, i) => {
            const raw = typeof e === 'object' ? JSON.stringify(e, null, 2) : String(e);
            validationInfo.push(`  ${i + 1}. ${raw}`);
        });
    }

    if (validationInfo.length > 0) {
        message += `\n${validationInfo.join('\n')}`;
    }

    return message;
}
//
const logger = {
    info: (...args) => {
        const msg = args.join(" ");
        const line = `${ts()} [INFO] ${msg}`;
        console.log(levelColors.info(line));
        writeToStream(combinedLogStream, line);
    },

    warn: (...args) => {
        const msg = args.join(" ");
        const line = `${ts()} [WARN] ${msg}`;
        console.log(levelColors.warn(line));
        writeToStream(combinedLogStream, line);
    },

    warnAlert: (...args) => {
        const msg = args.join(" ");
        const line = `${ts()} [WARN] ${msg}`;
        console.log(levelColors.warn(line));
        writeToStream(combinedLogStream, line);
        logger.alertSync(msg, "WARN");
    },

    error: (...args) => {
        let explicitContext = null;
        if (args.length > 1 && typeof args[args.length - 1] === 'object' &&
            !(args[args.length - 1] instanceof Error) &&
            (args[args.length - 1].guildId || args[args.length - 1].userId ||
                args[args.length - 1].command || args[args.length - 1].action)) {
            explicitContext = args.pop();
        }

        const ctx = { ...getContext(), ...explicitContext };
        const contextStr = formatContext(ctx);

        const processedArgs = args.map(arg => {
            if (arg instanceof Error) {
                const isValidationError = arg.validator || arg.expected || arg.given !== undefined || arg.errors;

                const discordCode = extractDiscordErrorCode(arg);
                const codeStr = discordCode ? ` [Discord Code: ${discordCode}]` : '';

                if (isValidationError) {
                    const cleanMessage = formatValidationError(arg);
                    return `${cleanMessage}${codeStr}\nStack Trace:\n${arg.stack}`;
                }

                const cleanMessage = arg.message || 'Unknown error';
                const stackInfo = extractRelevantStackInfo(arg.stack) || arg.stack;
                return `Error: ${cleanMessage}${codeStr}\nStack Trace:\n${stackInfo}`;
            }
            return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg;
        });

        const msg = processedArgs.join(" ");
        const contextPrefix = contextStr ? `${contextStr} ` : '';
        const line = `${ts()} [ERROR] ${contextPrefix}${msg}`;
        console.log(levelColors.error(line));
        writeToStream(combinedLogStream, line);
        writeToStream(errorLogStream, line);

        if (line.includes("Discord Error") || ctx.guildId) {
            logger.alertSync(`${contextPrefix}${msg}`, "ERROR");
        }
    },

    fatal: (...args) => {
        const msg = args.join(" ");
        const line = `${ts()} [FATAL] ${msg}`;
        console.log(levelColors.fatal(line));
        writeToStream(combinedLogStream, line);
        writeToStream(errorLogStream, line);
        logger.alertSync(msg, "FATAL");
    },

    debug: (...args) => {
        if (settings.debug == 'true') {
            const msg = args.join(" ");
            const line = `${ts()} [DEBUG] ${msg}`;
            console.log(levelColors.debug(line));
            writeToStream(combinedLogStream, line);
        }
    },

    neon: (msg) => console.log(`\x1b[95m${msg}\x1b[0m`),

    gradient: (msg) => {
        const colors = ["31", "33", "32", "36", "34", "35"];
        const chars = msg.split("");
        let out = chars.map((c, i) => `\x1b[${colors[i % colors.length]}m${c}\x1b[0m`).join("");
        console.log(out);
    },

    bigSuccess: (msg) => {
        const border = chalk.green("========================================");
        console.log(`\n${border}\n${chalk.green("   " + msg + "   ")}\n${border}\n`);
        logger.alertSync(msg, "SUCCESS");
    },

    alert: (msg, level = "INFO") => {
        logger.alertSync(msg, level);
    },

    alertSync: async (msg, level = "INFO") => {
        if (!webhookFatal) {
            console.log(`[WEBHOOK NOT SENT - NO URL, NO HAIR.] ${level}: ${msg}`);
            return;
        }

        try {
            const response = await sendWebhookImmediate(webhookFatal, msg, level);
        } catch (err) {
            console.error("webhook failed:", err.message);
        }
    }
};

logger.setContext = setContext;
logger.clearContext = clearContext;
logger.getContext = getContext;

module.exports = logger;