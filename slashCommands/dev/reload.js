const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const settings = require("../../util/settings.json");
const logger = require("../../logger.js");
const { deployCommands } = require("../../deploy-commands.js");
const e = require("../../data/emoji.js");

function traverse(dir, filename) {
	for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
		const direntPath = path.join(dir, dirent.name);
		if (dirent.isDirectory()) {
			const result = traverse(direntPath, filename);
			if (result) return result;
		}
		else if (dirent.name === filename + ".js") { return direntPath; }
	}
	return null;
}
//
module.exports = {
	data: new SlashCommandBuilder()
		.setName("reload")
		.setDescription("Reload commands, events, or deploy all slash commands")
		.addSubcommand(subcommand =>
			subcommand
				.setName("command")
				.setDescription("Reload a single slash command")
				.addStringOption(option =>
					option.setName("name")
						.setDescription("Name of the command to reload")
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName("event")
				.setDescription("Reload a single event")
				.addStringOption(option =>
					option.setName("name")
						.setDescription("Name of the event to reload (filename without .js)")
						.setRequired(true)))
		.addSubcommand(subcommand =>
			subcommand
				.setName("all-events")
				.setDescription("Reload all events"))
		.addSubcommand(subcommand =>
			subcommand
				.setName("all-commands")
				.setDescription("Reload all slash commands"))
		.addSubcommand(subcommand =>
			subcommand
				.setName("deploy")
				.setDescription("Re-deploy all slash commands via REST")),
	dev: true,
	explicit: process.env.CANARY === "true" ? false : true,
	async execute(bot, interaction, funcs) {
		if (!settings.devs.includes(interaction.user.id)) {
			return interaction.reply({ content: `${e.deny} You don't have permission to use this command.`, flags: MessageFlags.Ephemeral });
		}

		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "command") {
			const commandName = interaction.options.getString("name");
			const command = bot.slashCommands.get(commandName);

			if (!command) return interaction.reply({ content: `${e.deny} There is no command with the name \`${commandName}\`!`, flags: MessageFlags.Ephemeral });

			const commandFile = traverse(path.join(__dirname, "../../slashCommands"), commandName);
			if (!commandFile) return interaction.reply({ content: `${e.deny} File not found`, flags: MessageFlags.Ephemeral });
			delete require.cache[require.resolve(commandFile)];

			try {
				const newCommand = require(commandFile);
				bot.slashCommands.set(newCommand.data.name, newCommand);
				interaction.reply({ content: `${e.checkmark_green} Command \`${command.data.name}\` was reloaded!` });
			}
			catch (error) {
				logger.error(error);
				interaction.reply({ content: `${e.cross_white} There was an error while reloading the command \`${command.data.name}\`:\n\`${error.message}\``, flags: MessageFlags.Ephemeral });
			}
		} else if (subcommand === "event") {
			const eventName = interaction.options.getString("name");
			const eventsDir = path.join(__dirname, "../../events");
			const eventPath = path.join(eventsDir, `${eventName}.js`);

			if (!fs.existsSync(eventPath)) {
				return interaction.reply({ content: `${e.deny} Event file \`${eventName}.js\` not found!`, flags: MessageFlags.Ephemeral });
			}

			try {
				const currentEvent = require(eventPath);
				if (currentEvent.name) {
					bot.removeAllListeners(currentEvent.name);
				}

				delete require.cache[require.resolve(eventPath)];
				const newEvent = require(eventPath);
				bot.on(newEvent.name, (...args) => newEvent.execute(bot, ...args));

				interaction.reply({ content: `${e.checkmark_green} Event \`${eventName}.js\` was reloaded!` });
			} catch (error) {
				logger.error(error);
				interaction.reply({ content: `${e.cross_white} There was an error while reloading the event \`${eventName}\`:\n\`${error.message}\``, flags: MessageFlags.Ephemeral });
			}
		} else if (subcommand === "all-events") {
			await interaction.deferReply();

			try {
				const eventsDir = path.join(__dirname, "../../events");
				const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
				let reloaded = 0;
				let failed = 0;

				for (const file of eventFiles) {
					const eventPath = path.join(eventsDir, file);
					try {
						const currentEvent = require(eventPath);
						if (currentEvent.name) {
							bot.removeAllListeners(currentEvent.name);
						}

						delete require.cache[require.resolve(eventPath)];
						const newEvent = require(eventPath);
						bot.on(newEvent.name, (...args) => newEvent.execute(bot, ...args));
						reloaded++;
					} catch (err) {
						logger.error(`Failed to reload event ${file}:`, err);
						failed++;
					}
				}

				await interaction.editReply({
					content: `${e.checkmark_green} Reloaded ${reloaded}/${eventFiles.length} events${failed > 0 ? ` (${failed} failed)` : ''}`
				});
			} catch (error) {
				logger.error("Error reloading all events:", error);
				await interaction.editReply({ content: `${e.cross_white} An error occurred while reloading events:\n\`${error.message}\`` });
			}
		} else if (subcommand === "all-commands") {
			await interaction.deferReply();

			try {
				let reloaded = 0;
				let failed = 0;

				for (const [name, command] of bot.slashCommands) {
					const commandFile = traverse(path.join(__dirname, "../../slashCommands"), name);
					if (commandFile) {
						try {
							delete require.cache[require.resolve(commandFile)];
							const newCommand = require(commandFile);
							bot.slashCommands.set(newCommand.data.name, newCommand);
							reloaded++;
						} catch (err) {
							logger.error(`Failed to reload command ${name}:`, err);
							failed++;
						}
					}
				}

				await interaction.editReply({
					content: `${e.checkmark_green} Reloaded ${reloaded}/${bot.slashCommands.size} commands${failed > 0 ? ` (${failed} failed)` : ''}`
				});
			} catch (error) {
				logger.error("Error reloading all commands:", error);
				await interaction.editReply({ content: `${e.cross_white} An error occurred while reloading commands:\n\`${error.message}\`` });
			}
		} else if (subcommand === "deploy") {
			await interaction.deferReply();

			try {
				await deployCommands();
				await interaction.editReply({ content: `${e.checkmark_green} Successfully deployed all slash commands!` });
				logger.alert(`${interaction.user.tag} Triggered slash commands deployment.`, "SUCCESS");
			} catch (error) {
				logger.error("Error deploying commands:", error);
				await interaction.editReply({ content: `${e.cross_white} An error occurred while deploying commands:\n\`${error.message}\`` });
			}
		}
	},
	help: {
		name: "reload",
		description: "Reload commands, events, or deploy all commands",
		category: "Dev",
		permissions: ["Developer"],
		botPermissions: [],
		created: 1764938508
	}
};
