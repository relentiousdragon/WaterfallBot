const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config();
const mongoose = require("./mongoose.js");
const logger = require("./logger.js");

const botFilePath = path.join(__dirname, "shardManager.js");

let botProcess = null;
let restartCount = 0;
let lastRestartTime = Date.now();
let restartInterval = 5000;

const MAX_RESTARTS_PER_HOUR = 5;
const MAX_BACKOFF = 900000;
//
function startBot() {
    logger.warn("Starting bot process...");

    botProcess = spawn("node", [botFilePath], {
        stdio: ["inherit", "inherit", "pipe"],
    });

    botProcess.stderr.on("data", (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) logger.error(line);
    });

    botProcess.on("exit", (code, signal) => {
        if (shuttingDown) {
            logger.error(`Bot process exited during shutdown | code: ${code} | signal: ${signal}`);
            return;
        }

        logger.error(`Bot process exited | code: ${code} | signal: ${signal}`);

        const now = Date.now();
        if (now - lastRestartTime > 3600000) restartCount = 0;

        restartCount++;
        lastRestartTime = now;

        if (restartCount > MAX_RESTARTS_PER_HOUR) {
            logger.error("Too many restarts this hour, halting manager.");
            return;
        }

        if (code !== 0 && signal !== "SIGINT") {
            logger.warn(`Restarting shard in ${restartInterval / 1000}s ...`);
            setTimeout(startBot, restartInterval);
            restartInterval = Math.min(restartInterval * 2, MAX_BACKOFF);
        }
    });
}

function checkEnv() {
    const required = ["token", "SHARD_ID"];
    const optional = ["CLIENT_ID", "GITHUB_WEBHOOK_SECRET", "TOPGG_AUTH"];
    let missingRequired = false;

    for (const req of required) {
        if (!process.env[req] || process.env[req].trim() === "") {
            logger.fatal(`Missing required environment variable: ${req}`);
            missingRequired = true;
        }
    }

    if (missingRequired) {
        logger.fatal("Exiting due to missing required environment variables.");
        process.exit(1);
    }

    for (const opt of optional) {
        if (!process.env[opt] || process.env[opt].trim() === "") {
            logger.warn(`Missing environment variable: ${opt}`);
        }
    }
}

async function initialize() {
    checkEnv();
    try {
        await mongoose.init();
        startBot();
    } catch (error) {
        logger.fatal("Failed to initialize:", error);
        process.exit(1);
    }
}

initialize();

let shuttingDown = false;

async function shutdown(reason = "UNKNOWN") {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(`Received shutdown signal (${reason}) - cleaning up...`);

    try {
        await logger.alertSync(`Shutdown initiated: ${reason}`, "WARN");
    } catch (e) {
        console.error("Shutdown alert failed:", e);
    }

    try {
        if (botProcess && !botProcess.killed) {
            logger.info("Stopping bot child process...");

            botProcess.kill("SIGTERM");

            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                botProcess.once("exit", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            if (!botProcess.killed) {
                logger.warn("Force killing child process...");
                botProcess.kill("SIGKILL");
            }
        }
    } catch (e) {
        logger.error("Failed to stop bot process:", e.message);
    }

    try {
        await mongoose.close();
    } catch (e) {
        console.error("DB close failure:", e);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    console.log("Exiting, BYEEEE.");
    process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
    logger.fatal("Uncaught Exception:", err.stack || err);
    shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
    logger.fatal("Unhandled Rejection:", reason);
    shutdown("unhandledRejection");
});