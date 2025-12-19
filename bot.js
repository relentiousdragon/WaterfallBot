const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
require("dotenv").config();
const mongoose = require("./mongoose.js");
const logger = require("./logger.js");

const botFilePath = path.join(__dirname, "shardManager.js");
const settingsPath = path.join(__dirname, "util", "settings.json");

let botProcess = null;
let restartCount = 0;
let lastRestartTime = Date.now();
let restartInterval = 5000;
let isReloading = false;

const MAX_RESTARTS_PER_HOUR = 5;
const MAX_BACKOFF = 900000;
//
function startBot() {
    logger.warn("Starting bot process...");

    botProcess = spawn("node", [botFilePath], {
        stdio: ["inherit", "inherit", "pipe", "ipc"],
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

        if (isReloading) {
            isReloading = false;
            logger.warn(`Reloading shard in ${restartInterval / 1000}s ...`);
            setTimeout(startBot, restartInterval);
            restartInterval = Math.min(restartInterval * 2, MAX_BACKOFF);
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

function setupConsole() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ''
    });

    console.log('\nType "help" for commands.\n');

    rl.on('line', async (line) => {
        const input = line.trim().toLowerCase();
        const args = input.split(/\s+/);
        const command = args[0];

        switch (command) {
            case 'help':
                console.log(`
╔═══════════════════════════════════════════════════════╗
║                       COMMANDS                        ║
╠═══════════════════════════════════════════════════════╣
║  reload           - Restart the shard                 ║
║  deploy           - Deploy slash commands             ║
║  reload-commands  - Reload command files              ║
║  reload-events    - Reload event files                ║
║  git-pull         - Pull latest from git              ║
║  git-status       - Show git status                   ║
║  debug [on|off]   - Toggle debug mode                 ║
║  translations     - Run translation check             ║
║  fix-translations - Remove unused translation keys    ║
║  status           - Show bot status                   ║
║  help             - show this help message            ║
╚═══════════════════════════════════════════════════════╝
`);
                break;

            case 'reload':
            case 'restart':
                console.log('Reloading Shard...');
                if (botProcess && botProcess.exitCode === null && botProcess.signalCode === null) {
                    isReloading = true;
                    restartInterval = 5000;
                    botProcess.kill('SIGTERM');
                } else {
                    startBot();
                }
                break;

            case 'deploy':
                console.log('Deploying commands...');
                try {
                    execSync('node deploy-commands.js', {
                        stdio: 'inherit',
                        cwd: __dirname
                    });
                    console.log('Commands deployed successfully');
                } catch (err) {
                    console.error('Deploy failed:', err.message);
                }
                break;

            case 'reload-commands':
                if (botProcess && botProcess.exitCode === null && botProcess.signalCode === null) {
                    botProcess.send({ type: 'reload-commands' });
                    console.log('Sent reload command to shard');
                } else {
                    console.log('Bot process not running');
                }
                break;

            case 'reload-events':
                console.log('Reloading events...');
                if (botProcess && botProcess.exitCode === null && botProcess.signalCode === null) {
                    botProcess.send({ type: 'reload-events' });
                    console.log('Sent reload command to shard');
                } else {
                    console.log('Bot process not running');
                }
                break;

            case 'git-pull':
            case 'pull':
                console.log('Pulling from git...');
                try {
                    const output = execSync('git pull', {
                        cwd: __dirname,
                        encoding: 'utf8'
                    });
                    console.log(output);
                } catch (err) {
                    console.error('Git pull failed:', err.message);
                }
                break;

            case 'git-status':
            case 'status-git':
                try {
                    const output = execSync('git status --short', {
                        cwd: __dirname,
                        encoding: 'utf8'
                    });
                    console.log('Git Status:');
                    console.log(output || '  (no changes)');
                } catch (err) {
                    console.error('Git status failed:', err.message);
                }
                break;

            case 'debug':
                try {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                    const newValue = args[1] === 'on' ? 'true' : args[1] === 'off' ? 'false' : (settings.debug === 'true' ? 'false' : 'true');
                    settings.debug = newValue;
                    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                    console.log(`Debug mode: ${newValue === 'true' ? 'ON' : 'OFF'}`);
                    console.log('   Note: Restart shard for changes to take effect');
                } catch (err) {
                    console.error('Failed to toggle debug:', err.message);
                }
                break;

            case 'translations':
            case 'check-translations':
                console.log('Running translation check...');
                try {
                    execSync('node scripts/check-translations.js', {
                        stdio: 'inherit',
                        cwd: __dirname
                    });
                } catch (err) {
                    //
                }
                break;

            case 'fix-translations':
                console.log('Removing unused translation keys...');
                try {
                    execSync('node scripts/check-translations.js --remove-unused', {
                        stdio: 'inherit',
                        cwd: __dirname
                    });
                } catch (err) {
                    console.error('Failed:', err.message);
                }
                break;

            case 'status':
                const isRunning = botProcess && botProcess.exitCode === null && botProcess.signalCode === null;
                console.log(`
Bot Status
─────────────────────────────────
  Process: ${isRunning ? 'Running' : 'Stopped'}
  PID: ${botProcess?.pid || 'N/A'}
  Restarts this hour: ${restartCount}
  Uptime: ${formatUptime(process.uptime())}
`);
                break;

            case '':
                break;

            default:
                console.log(`Unknown command: ${command}. Type "help" for available commands bald.`);
        }
    });

    rl.on('close', () => {
        console.log('Console closed');
    });
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

async function initialize() {
    checkEnv();
    try {
        await mongoose.init();
        startBot();
        setupConsole();
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