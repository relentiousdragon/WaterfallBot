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

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "Waterfall",
                embeds: [
                    {
                        title: `BALD: ${level}`,
                        description: diffMessage,
                        color:
                            level === "FATAL" ? 0xFF5555 :
                                level === "ERROR" ? 0xFF6B6B :
                                    level === "SUCCESS" ? 0x4ADE80 :
                                        level === "WARN" ? 0xFACC15 :
                                            level === "INFO" ? 0x3B82F6 :
                                                0x60A5FA,
                        timestamp: new Date().toISOString(),
                        footer: { text: `Shard ${process.env.SHARD_ID || 0}` }
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

function extractRelevantStackInfo(stack, maxFiles = 3) {
    if (!stack) return "No stack trace";

    const lines = stack.split('\n').slice(1);
    const relevantLines = [];

    for (const line of lines) {
        if (line.includes('node_modules') || line.includes('node:internal')) {
            continue;
        }

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

    return relevantLines.length > 0 ? relevantLines.join('\n') : '  [Stack trace filtered]';
}

function formatValidationError(error) {
    let message = error.message || 'Validation Error';

    const validationInfo = [];

    if (error.validator) {
        validationInfo.push(`Validator: ${error.validator}`);
    }
    if (error.expected) {
        validationInfo.push(`Expected: ${error.expected}`);
    }
    if (error.given !== undefined) {
        validationInfo.push(`Received: ${JSON.stringify(error.given)}`);
    }

    if (error.errors && Array.isArray(error.errors)) {
        const errorSummaries = error.errors.slice(0, 3).map((e, i) => {
            if (typeof e === 'object' && e !== null) {
                return `  ${i + 1}. ${e.property || 'Unknown'}: ${e.message || 'Invalid value'}`;
            }
            return `  ${i + 1}. ${e}`;
        });

        if (error.errors.length > 3) {
            errorSummaries.push(`  ... and ${error.errors.length - 3} more errors`);
        }

        validationInfo.push('Issues:', ...errorSummaries);
    }

    if (validationInfo.length > 0) {
        message += `\n${validationInfo.join('\n')}`;
    }

    return message;
}

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
        const processedArgs = args.map(arg => {
            if (arg instanceof Error) {
                const isValidationError = arg.validator || arg.expected || arg.given !== undefined || arg.errors;

                if (isValidationError) {
                    const cleanMessage = formatValidationError(arg);
                    const stackInfo = extractRelevantStackInfo(arg.stack);
                    return `${cleanMessage}\n${stackInfo}`;
                }

                const cleanMessage = arg.message;
                const stackInfo = extractRelevantStackInfo(arg.stack);
                return `${cleanMessage}\n${stackInfo}`;
            }
            return arg;
        });

        const msg = processedArgs.join(" ");
        const line = `${ts()} [ERROR] ${msg}`;
        console.log(levelColors.error(line));
        writeToStream(combinedLogStream, line);
        writeToStream(errorLogStream, line);

        if (line.includes("Discord Error")) {
            logger.alertSync(msg, "ERROR");
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

module.exports = logger;