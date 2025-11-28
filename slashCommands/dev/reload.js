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
		.setDescription("Reload commands or deploy all slash commands")
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
				.setName("deploy")
				.setDescription("Re-deploy all slash commands via REST")),
	dev: true,
	explicit: true,
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
				interaction.reply({ content: `${e.checkmark_green} Command \`${command.data.name}\` was reloaded!`, flags: MessageFlags.Ephemeral });
			}
			catch (error) {
				logger.error(error);
				interaction.reply({ content: `${e.cross_white} There was an error while reloading the command \`${command.data.name}\`:\n\`${error.message}\``, flags: MessageFlags.Ephemeral });
			}
		} else if (subcommand === "deploy") {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
		description: "Reload a slash command or deploy all commands",
		category: "Dev",
		permissions: [],
		botPermissions: []
	}
};

