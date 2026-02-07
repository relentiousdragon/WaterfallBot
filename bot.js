const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
require("dotenv").config();
const mongoose = require("./mongoose.js");
const logger = require("./logger.js");

const botFilePath = path.join(__dirname, "shardManager.js");
const settingsPath = path.join(__dirname, "util", "settings.json");
const settingsExamplePath = path.join(__dirname, "util", "settings.json.example");

let botProcess = null;
let restartCount = 0;
let lastRestartTime = Date.now();
let restartInterval = 5000;
let isReloading = false;
let isSpawning = false;
let lastSpawnAttempt = 0;

const MAX_RESTARTS_PER_HOUR = 5;
const MAX_BACKOFF = 900000;
const MIN_SPAWN_INTERVAL = 2000;
//
function startBot() {
    if (isSpawning) {
        return;
    }

    const now = Date.now();
    if (now - lastSpawnAttempt < MIN_SPAWN_INTERVAL) {
        logger.warn(`Spawn attempt throttled (${MIN_SPAWN_INTERVAL}ms cooldown)`);
        return;
    }

    isSpawning = true;
    lastSpawnAttempt = now;
    logger.warn("Starting bot process...");

    botProcess = spawn("node", [botFilePath], {
        stdio: ["inherit", "inherit", "pipe", "ipc"],
    });

    botProcess.stderr.on("data", (data) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) logger.error(line);
    });

    botProcess.on("exit", (code, signal) => {
        isSpawning = false;
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
            const delay = Math.max(restartInterval, MIN_SPAWN_INTERVAL);
            logger.warn(`Reloading shard in ${delay / 1000}s ...`);
            setTimeout(startBot, delay);
            restartInterval = Math.min(restartInterval * 2, MAX_BACKOFF);
            return;
        }

        if (code !== 0 && signal !== "SIGINT") {
            const delay = Math.max(restartInterval, MIN_SPAWN_INTERVAL);
            logger.warn(`Restarting shard in ${delay / 1000}s ...`);
            setTimeout(startBot, delay);
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

function checkVersion() {
    const pkgPath = path.join(__dirname, "package.json");
    if (!fs.existsSync(pkgPath) || !fs.existsSync(settingsPath)) return;

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

        if (settings.version !== pkg.version) {
            logger.warnAlert(`Version mismatch detected: package.json (${pkg.version}) vs settings.json (${settings.version || "N/A"}). Updating settings.json...`);
            settings.version = pkg.version;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
        }
    } catch (err) {
        logger.error(`Error during version check: ${err.message}`);
    }
}

async function checkCreditsEmojis() {
    if (!fs.existsSync(settingsPath)) return;

    const token = process.env.token;
    const clientId = process.env.CLIENT_ID;

    if (!token || !clientId) {
        logger.warn("[Credits] Missing token or CLIENT_ID, skipping emoji upload.");
        return;
    }

    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

        if (!settings.c_emojis) {
            logger.warn("[Credits] c_emojis key missing in settings.json. Initializing from example...");
            if (fs.existsSync(settingsExamplePath)) {
                try {
                    const exampleSettings = JSON.parse(fs.readFileSync(settingsExamplePath, "utf8"));
                    settings.c_emojis = exampleSettings.c_emojis || {};
                    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
                } catch (exErr) {
                    logger.error(`[Credits] Failed to read settings.json.example: ${exErr.message}`);
                    return;
                }
            } else {
                logger.error("[Credits] settings.json.example not found. Cannot initialize c_emojis.");
                return;
            }
        }

        const creditsDir = path.join(__dirname, "assets", "credits");
        const uploadedEmojis = [];
        const missingAssets = [];

        for (const [key, value] of Object.entries(settings.c_emojis)) {
            if (value !== "?") continue;

            const parts = key.split("_");
            const user = parts.slice(0, -1).join("_");
            const num = parts[parts.length - 1];

            let assetPath = path.join(creditsDir, user, `${num}.png`);
            let mimeType = "image/png";

            if (!fs.existsSync(assetPath)) {
                assetPath = path.join(creditsDir, user, `${num}.jpeg`);
                mimeType = "image/jpeg";
            }

            if (!fs.existsSync(assetPath)) {
                missingAssets.push(key);
                continue;
            }

            try {
                const imageBuffer = fs.readFileSync(assetPath);
                const base64Image = imageBuffer.toString("base64");
                const dataUri = `data:${mimeType};base64,${base64Image}`;

                const response = await fetch(`https://discord.com/api/v10/applications/${clientId}/emojis`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bot ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: key.replace(/[^a-zA-Z0-9_]/g, "_"),
                        image: dataUri
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    settings.c_emojis[key] = data.id;
                    uploadedEmojis.push({ name: key, id: data.id });
                } else {
                    const errData = await response.json().catch(() => ({}));
                    logger.warn(`[Credits] Failed to upload ${key}: ${errData.message || response.status}`);
                }
            } catch (uploadErr) {
                logger.warn(`[Credits] Upload error for ${key}: ${uploadErr.message}`);
            }
        }

        for (const asset of missingAssets) {
            logger.warn(`[Credits] Missing asset for: ${asset}`);
        }

        if (uploadedEmojis.length > 0) {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");

            if (uploadedEmojis.length <= 5) {
                for (const emoji of uploadedEmojis) {
                    logger.warnAlert(`[Credits] Uploaded emoji: ${emoji.name} (ID: ${emoji.id})`);
                }
            } else {
                logger.warnAlert(`[Credits] ${uploadedEmojis.length} assets were uploaded to Discord as emojis.`);
            }
        }
    } catch (err) {
        logger.error(`[Credits] Error during emoji check: ${err.message}`);
    }
}

async function checkAvatarEmojis() {
    if (!fs.existsSync(settingsPath)) return;

    const token = process.env.token;
    const clientId = process.env.CLIENT_ID;

    if (!token || !clientId) {
        logger.warn("[Avatars] Missing token or CLIENT_ID, skipping emoji upload.");
        return;
    }

    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

        if (!settings.a_emojis) {
            logger.warn("[Avatars] a_emojis key missing in settings.json. Initializing from example...");
            if (fs.existsSync(settingsExamplePath)) {
                try {
                    const exampleSettings = JSON.parse(fs.readFileSync(settingsExamplePath, "utf8"));
                    settings.a_emojis = exampleSettings.a_emojis || {};
                    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");
                } catch (exErr) {
                    logger.error(`[Avatars] Failed to read settings.json.example: ${exErr.message}`);
                    return;
                }
            } else {
                logger.error("[Avatars] settings.json.example not found. Cannot initialize a_emojis.");
                return;
            }
        }

        const avatarsDir = path.join(__dirname, "assets", "avatars-split");
        const uploadedEmojis = [];
        const missingAssets = [];

        for (const [key, value] of Object.entries(settings.a_emojis)) {
            if (value !== "?") continue;

            const parts = key.split("_");
            const style = parts.slice(0, -1).join("_");
            const num = parts[parts.length - 1];

            let assetPath = path.join(avatarsDir, style, `${num}.png`);
            let mimeType = "image/png";

            if (!fs.existsSync(assetPath)) {
                assetPath = path.join(avatarsDir, style, `${num}.webp`);
                mimeType = "image/webp";
            }

            if (!fs.existsSync(assetPath)) {
                assetPath = path.join(avatarsDir, style, `${num}.jpeg`);
                mimeType = "image/jpeg";
            }

            if (!fs.existsSync(assetPath)) {
                missingAssets.push(key);
                continue;
            }

            try {
                const imageBuffer = fs.readFileSync(assetPath);
                const base64Image = imageBuffer.toString("base64");
                const dataUri = `data:${mimeType};base64,${base64Image}`;

                const response = await fetch(`https://discord.com/api/v10/applications/${clientId}/emojis`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bot ${token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: `avatar_${key}`.replace(/[^a-zA-Z0-9_]/g, "_"),
                        image: dataUri
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    settings.a_emojis[key] = data.id;
                    uploadedEmojis.push({ name: key, id: data.id });
                } else {
                    const errData = await response.json().catch(() => ({}));
                    logger.warn(`[Avatars] Failed to upload ${key}: ${errData.message || response.status}`);
                }
            } catch (uploadErr) {
                logger.warn(`[Avatars] Upload error for ${key}: ${uploadErr.message}`);
            }
        }

        for (const asset of missingAssets) {
            logger.warn(`[Avatars] Missing asset for: ${asset}`);
        }

        if (uploadedEmojis.length > 0) {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), "utf8");

            if (uploadedEmojis.length <= 5) {
                for (const emoji of uploadedEmojis) {
                    logger.warnAlert(`[Avatars] Uploaded emoji: ${emoji.name} (ID: ${emoji.id})`);
                }
            } else {
                logger.warnAlert(`[Avatars] ${uploadedEmojis.length} avatar assets were uploaded to Discord as emojis.`);
            }
        }
    } catch (err) {
        logger.error(`[Avatars] Error during emoji check: ${err.message}`);
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
                    lastSpawnAttempt = 0;
                    isSpawning = false;
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
    checkVersion();
    try {
        await mongoose.init();
        await checkCreditsEmojis();
        await checkAvatarEmojis();
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
    isSpawning = false;
    lastSpawnAttempt = 0;

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


// contributors: @relentiousdragon