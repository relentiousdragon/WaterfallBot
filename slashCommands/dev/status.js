const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const { settings, saveSettings } = require("../../index.js");
const e = require("../../data/emoji.js");
const logger = require("../../logger.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show current performance metrics. (DEV ONLY)")
        .addStringOption(option =>
            option.setName("status")
                .setDescription("Update status: maintenance, none, or reload")
                .setRequired(false)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: true,
    explicit: true,
    async execute(bot, interaction) {
        if (!settings.devs.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${e.deny} You don't have permission to use this command.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const newStatus = interaction.options.getString("status");
        if (newStatus) {
            const lowerStatus = newStatus.toLowerCase();

            if (lowerStatus === "reload") {
                await interaction.reply({ content: `${e.reload} Restarting shard...` });
                process.exit(1);
                return;
            }

            if (lowerStatus === "maintenance" || lowerStatus === "none") {
                settings.event = lowerStatus;
                saveSettings();
                return interaction.reply({ content: `${e.tools} Status changed to: **${lowerStatus.charAt(0).toUpperCase() + lowerStatus.slice(1)}**` });
            } else {
                return interaction.reply({
                    content: `${e.deny} Invalid status. Please use \`maintenance\`, \`none\`, or \`reload\`.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (settings.event === "maintenance") {
            return interaction.reply({ content: `${e.tools} The bot is currently on maintenance. We'll be back soon.`, flags: MessageFlags.Ephemeral });
        }

        const responseLatency = Date.now() - interaction.createdTimestamp;
        const startAPI = Date.now();
        try {
            await bot.rest.get("/users/@me");
        } catch (err) {
            logger.error("Error fetching API data:", err);
        }
        const apiLatency = Date.now() - startAPI;
        const websocketPing = bot.ws.ping;

        const getEmoji = (latency) => {
            if (latency < 100) return e.lightning_green;
            else if (latency < 200) return e.lightning_yellow;
            else if (latency < 300) return e.lightning_orange;
            else return e.lightning_red;
        };

        const embed = new EmbedBuilder()
            .setColor("#A0DB8E")
            .setTitle(`${e.status_online} Status Report ${e.status_online}`)
            .setDescription("Current performance metrics:")
            .addFields(
                { name: "Response Latency", value: `${responseLatency}ms ${getEmoji(responseLatency)}`, inline: true },
                { name: "WebSocket Ping", value: `${websocketPing}ms ${getEmoji(websocketPing)}`, inline: true },
                { name: "API Latency", value: `${apiLatency}ms ${getEmoji(apiLatency)}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: "Status Check", iconURL: bot.user.displayAvatarURL() });

        return interaction.reply({ embeds: [embed] });
    },
    help: {
        name: "status",
        description: "Show current performance metrics",
        category: "Dev",
        permissions: [],
        botPermissions: []
    }
};