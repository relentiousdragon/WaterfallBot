const { SlashCommandBuilder, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const shardStats = require("../../schemas/shardStats.js");
const e = require("../../data/emoji.js");

const formatUptime = (uptime) => {
    const seconds = Math.floor((uptime / 1000) % 60);
    const minutes = Math.floor((uptime / (1000 * 60)) % 60);
    const hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
};
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("botstats")
        .setDescription("Display bot performance metrics."),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger) {
        const shardId = bot.shard.ids[0];
        const shardUptime = process.uptime() * 1000;
        const formattedUptime = formatUptime(shardUptime);
        const totalShards = bot.shard.count;

        const latency = Date.now() - interaction.createdTimestamp;
        let latencyEmoji = "";
        let embedColor = 0x4756ff;

        if (latency < 100) {
            latencyEmoji = e.lightning_green;
            embedColor = 0x1ABC9C;
        } else if (latency < 200) {
            latencyEmoji = e.lightning_yellow;
            embedColor = 0xF1C40F;
        } else if (latency < 300) {
            latencyEmoji = e.lightning_orange;
            embedColor = 0xE67E22;
        } else {
            latencyEmoji = e.lightning_red;
            embedColor = 0xE74C3C;
        }

        const status = settings.event === "maintenance" ? "Maintenance" : "Online";

        let shardStatsDocs = await shardStats.find({});
        let totalGuilds = shardStatsDocs.reduce((sum, doc) => sum + (doc.guildCount || 0), 0);

        const shardServers = bot.guilds.cache.filter(guild => guild.shard.id === shardId).size;

        let shardname = shardId === 0 ? "SIEGE"
            : shardId === 1 ? "SUBZERO"
                : shardId === 2 ? "MIDNIGHT"
                    : `Shard ${shardId}`;

        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Waterfall Stats`),
                new TextDisplayBuilder().setContent(`-# ${e.icon_github} Release Notes available at [Github](https://github.com/DevSeige-Studios/WaterfallBot/releases)`)
            );

        const container = new ContainerBuilder()
            .setAccentColor(embedColor)
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### Shard Info:\n${e.pin} **Shard ${shardId}:** ${shardname}\n${e.calendar} **Total Shards:** ${totalShards}\n${e.green_point} **Uptime:** ${formattedUptime}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### Performance:\n${latencyEmoji} **Latency:** ${latency}ms\n${e.config} **Status:** ${status}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### General:\n${e.globe} **Total Servers:** ${totalGuilds}\n${e.home} **Shard Servers:** ${shardServers}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Version ${settings.version}  ‎ • ‎ Made with 💻 by DevSiege Studios`)
            );

        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    },
    help: {
        name: "botstats",
        description: "Display bot statistics",
        category: "General",
        permissions: [],
        botPermissions: []
    }
};
