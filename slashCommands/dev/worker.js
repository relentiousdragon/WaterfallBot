const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { send: sendHourly } = require("../../hourlyWorker.js");
const dailyWorker = require("../../dailyWorker.js");
const settings = require("../../util/settings.json");
const { db } = require("../../index.js");
const e = require("../../data/emoji.js");
//
module.exports = {
	data: new SlashCommandBuilder()
		.setName("worker")
		.setDescription("Manually trigger hourly income or daily worker tasks (DEV ONLY)")
		.addStringOption(option =>
			option.setName("type")
				.setDescription("Specify which worker to run")
				.setRequired(true)
				.addChoices(
					{ name: "hourly", value: "hourly" },
					{ name: "daily", value: "daily" }
				)
		),
	dev: true,
	explicit: true,
	async execute(bot, interaction, funcs) {
		await interaction.reply({ content: `${e.loading} Please wait...` });
		const type = interaction.options.getString("type");
		if (type === "hourly") {
			await sendHourly(bot);
			await interaction.editReply("Hourly Worker executed successfully.");
		} else if (type === "daily") {
			await dailyWorker.send(bot);
			await interaction.editReply("Daily Worker executed successfully.");
		} else {
			await interaction.editReply("Invalid worker type specified.");
		}
	},
	help: {
		name: "worker",
		description: "Manually trigger hourly or daily worker tasks",
		category: "Dev",
		permissions: [],
		botPermissions: []
	}
};
