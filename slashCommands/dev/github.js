const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const logger = require("../../logger.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("github")
        .setDescription("GitHub repository management (DEV ONLY)")
        .addSubcommand(subcommand =>
            subcommand
                .setName("pull")
                .setDescription("Pull latest changes from GitHub"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Check GitHub repository status")),
    dev: true,
    explicit: process.env.CANARY === "true" ? false : true,
    async execute(bot, interaction, funcs, settings, logger) {
        try {
            if (!settings.devs.includes(interaction.user.id)) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "pull") {
                await interaction.deferReply();
                await this.pullUpdates(bot, interaction);
            } else if (subcommand === "status") {
                await interaction.deferReply();
                await this.checkStatus(interaction);
            }
        } catch (error) {
            logger.error("Error executing github command:", error);
            return interaction.reply({ content: "An error occurred while executing the command.", flags: MessageFlags.Ephemeral });
        }
    },

    async pullUpdates(bot, interaction) {
        return new Promise((resolve) => {
            exec("git pull", { cwd: process.cwd() }, async (error, stdout, stderr) => {
                if (error) {
                    logger.error(`Git pull error: ${error}`);
                    await interaction.editReply({ content: `Error during git pull: ${error.message}` });
                    return resolve();
                }

                const output = stdout + stderr;
                logger.info(`Git pull output: ${output}`);

                const changedFiles = this.parseChangedFiles(output);
                const analysis = this.analyzeChanges(changedFiles);

                await logger.alertSync(`GitHub Sync: ${changedFiles.length} files updated | Hot Reload: ${analysis.hotReload.length} | Shard Restart: ${analysis.shardRestart.length} | Container Restart: ${analysis.containerRestart ? "YES" : "NO"}`, "INFO");

                let response = `**Git Pull Complete**\n\`\`\`\n${output}\n\`\`\``;

                if (analysis.containerRestart) {
                    response += "\n\n**CONTAINER RESTART REQUIRED**\nChanges to core files detected.";
                } else if (analysis.shardRestart.length > 0) {
                    response += `\n\n**SHARD RESTART REQUIRED**\nModified files: ${analysis.shardRestart.join(", ")}`;

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId("restart_shard")
                                .setLabel("Restart Shard Now")
                                .setStyle(ButtonStyle.Danger)
                        );

                    await interaction.editReply({
                        content: response,
                        components: [row]
                    });

                    const filter = i => i.customId === "restart_shard" && settings.devs.includes(i.user.id);
                    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

                    collector.on("collect", async i => {
                        await i.update({ content: "Restarting shard...", components: [] });
                        logger.warn(`Manual shard restart initiated by ${i.user.name}`);
                        process.exit(0);
                    });

                    collector.on("end", collected => {
                        if (collected.size === 0) {
                            interaction.editReply({ components: [] }).catch(() => { });
                        }
                    });

                    return resolve();
                } else if (analysis.hotReload.length > 0) {
                    response += `\n\n**HOT RELOADING**\nReloading: ${analysis.hotReload.join(", ")}`;
                    await interaction.editReply({ content: response });

                    await this.hotReloadFiles(bot, analysis.hotReload);
                } else {
                    response += "\n\nNo reload required";
                    await interaction.editReply({ content: response });
                }

                resolve();
            });
        });
    },

    async checkStatus(interaction) {
        return new Promise((resolve) => {
            exec("git status --porcelain", { cwd: process.cwd() }, async (error, stdout) => {
                if (error) {
                    await interaction.editReply({ content: `Error checking status: ${error.message}` });
                    return resolve();
                }

                const changes = stdout.trim();
                if (changes) {
                    await interaction.editReply({ content: `**Local Changes:**\n\`\`\`\n${changes}\n\`\`\`` });
                } else {
                    await interaction.editReply({ content: "No local changes" });
                }
                resolve();
            });
        });
    },

    parseChangedFiles(gitOutput) {
        const files = [];
        const lines = gitOutput.split("\n");

        for (const line of lines) {
            const match = line.match(/(?:create|delete|rename|)\s*(?:mode\s+\d+\s+)?([^\s=>]+)(?:\s*=>\s*([^\s]+))?/);
            if (match) {
                if (match[2]) {
                    files.push(match[1]);
                    files.push(match[2]);
                } else if (match[1] && !match[1].includes("=>")) {
                    files.push(match[1]);
                }
            }

            const simplePath = line.match(/^\s*[AMDR?]\s+([^\s]+)/);
            if (simplePath) {
                files.push(simplePath[1]);
            }
        }

        return [...new Set(files.filter(Boolean))];
    },

    analyzeChanges(changedFiles) {
        const hotReloadable = [
            "slashCommands/",
            "events/",
            "util/functions.js",
            "views/",
            "schemas/",
            "hourlyWorker.js",
            "dailyWorker.js",
            "locales/"
        ];

        const shardRestartRequired = [
            "index.js",
            "mongoose.js",
            "shardManager.js",
            "data/",
            "util/interactionHandlers.js"
        ];

        const containerRestartRequired = [
            "bot.js",
            "github.sh",
            "logger.js"
        ];

        const result = {
            hotReload: [],
            shardRestart: [],
            containerRestart: false
        };

        for (const file of changedFiles) {
            if (containerRestartRequired.some(restartFile => file.includes(restartFile))) {
                result.containerRestart = true;
            }

            if (shardRestartRequired.some(restartFile => file.includes(restartFile))) {
                result.shardRestart.push(file);
            }

            if (hotReloadable.some(reloadable => file.includes(reloadable))) {
                result.hotReload.push(file);
            }
        }

        return result;
    },

    async hotReloadFiles(bot, files) {
        for (const file of files) {
            try {
                if (file.startsWith("slashCommands/")) {
                    await this.reloadSlashCommand(bot, file);
                } else if (file.startsWith("events/")) {
                    await this.reloadEvent(bot, file);
                } else if (file.includes("settings.json")) {
                    await this.reloadSettings();
                } else if (file.startsWith("locales/")) {
                    await this.reloadLocales(file);
                } else if (file.includes("functions.js") || file.includes("interactionHandlers.js")) {
                    await this.reloadUtilFile(file);
                }
                logger.info(`Hot-reloaded: ${file}`);
            } catch (error) {
                logger.error(`Failed to hot-reload ${file}:`, error);
            }
        }
    },

    async reloadSlashCommand(bot, filePath) {
        const commandName = path.basename(filePath, ".js");
        const command = bot.slashCommands.get(commandName);

        if (!command) return;

        const actualPath = this.traverse(path.join(__dirname, "../../slashCommands"), commandName);
        if (!actualPath) return;

        delete require.cache[require.resolve(actualPath)];

        try {
            const newCommand = require(actualPath);
            bot.slashCommands.set(newCommand.data.name, newCommand);
        } catch (error) {
            throw new Error(`Slash command reload failed: ${error.message}`);
        }
    },

    async reloadEvent(bot, filePath) {
        const eventPath = path.join(__dirname, "../../events", filePath.replace("events/", ""));

        try {
            const currentEvent = require(eventPath);
            if (currentEvent.name) {
                bot.removeAllListeners(currentEvent.name);
            }
        } catch (error) {
            logger.warn(`Could not unload previous event for ${filePath}: ${error.message}`);
        }

        delete require.cache[require.resolve(eventPath)];

        try {
            const event = require(eventPath);
            bot.on(event.name, (...args) => event.execute(bot, ...args));
        } catch (error) {
            throw new Error(`Event reload failed: ${error.message}`);
        }
    },

    async reloadSettings() {
        const settingsPath = path.join(__dirname, "../../util/settings.json");
        delete require.cache[require.resolve(settingsPath)];
    },

    async reloadUtilFile(filePath) {
        const fullPath = path.join(__dirname, "../../", filePath);
        delete require.cache[require.resolve(fullPath)];
    },

    async reloadLocales(filePath) {
        const fullPath = path.join(__dirname, "../../", filePath);
        if (require.cache[require.resolve(fullPath)]) {
            delete require.cache[require.resolve(fullPath)];
        }

        const { reloadI18n } = require("../../util/i18n.js");
        await reloadI18n();

        logger.info(`Cleared locale cache for: ${filePath}`);
    },

    traverse(dir, filename) {
        for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const direntPath = path.join(dir, dirent.name);
            if (dirent.isDirectory()) {
                const result = this.traverse(direntPath, filename);
                if (result) return result;
            }
            else if (dirent.name === filename + ".js") {
                return direntPath;
            }
        }
        return null;
    },

    help: {
        name: "github",
        description: "GitHub repository management commands",
        category: "Dev",
        permissions: [],
        botPermissions: []
    }
};