const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, ThumbnailBuilder } = require('discord.js');
const commandMeta = require('../../util/i18n.js').getCommandMetadata();
const shardStats = require("../../schemas/shardStats.js");
const e = require("../../data/emoji.js");
const { parseEmoji } = require("../../util/functions.js");

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
        .setName('botstats')
        .setDescription('Display bot performance metrics.')
        .setNameLocalizations(commandMeta.botstats.name)
        .setDescriptionLocalizations(commandMeta.botstats.description),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

        try {
            const shardId = bot.shard.ids[0];
        const shardUptime = process.uptime() * 1000;
        const formattedUptime = formatUptime(shardUptime);
        const totalShards = bot.shard.count;

        const latency = Date.now() - interaction.createdTimestamp;
        let latencyEmoji = "";
        let embedColor = 0x4756ff;

        if (latency < 120) {
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

        const status = settings.event === "maintenance" ? t('commands:botstats.status_maintenance') : t('commands:botstats.status_online');

        let shardStatsDocs = await shardStats.find({});
        let totalGuilds = shardStatsDocs.reduce((sum, doc) => sum + (doc.guildCount || 0), 0);
        let totalUsers = shardStatsDocs.reduce((sum, doc) => sum + (doc.userCount || 0), 0);

        const shardServers = bot.guilds.cache.filter(guild => guild.shard.id === shardId).size;

        const isCanary = process.env.CANARY === 'true';

        let shardname = shardId === 0 ? (isCanary ? "MECH" : "SIEGE")
            : shardId === 1 ? "SUBZERO"
                : shardId === 2 ? "MIDNIGHT"
                    : `Shard ${shardId}`;

        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.user.displayAvatarURL()))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# ${t('commands:botstats.title')}`),
                new TextDisplayBuilder().setContent(`-# ${e.icon_github} ${t('commands:botstats.release_notes')}`)
            );

        const container = new ContainerBuilder()
            .setAccentColor(embedColor)
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${t('commands:botstats.shard_info')}\n${e.pin} ${t('commands:botstats.shard_name', { id: shardId, name: shardname })}\n${e.calendar} ${t('commands:botstats.total_shards', { count: totalShards })}\n${e.green_point} ${t('commands:botstats.uptime', { time: formattedUptime })}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${t('commands:botstats.performance')}\n${latencyEmoji} ${t('commands:botstats.latency', { ms: latency })}\n${e.config} ${t('commands:botstats.status', { status: status })}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${t('commands:botstats.general')}\n${e.globe} ${t('commands:botstats.total_servers', { count: totalGuilds })}\n${e.members} ${t('commands:botstats.total_users', { count: totalUsers })}\n${e.home} ${t('commands:botstats.shard_servers', { count: shardServers })}`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${t('commands:botstats.footer', { version: settings.version, canary: isCanary ? ' CANARY' : '', emoji: Math.random() < 0.05 ? (Math.random() < 0.5 ? '🧱' : '🍝') : '💻' })}`)
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('bot_credits')
                .setLabel(t('commands:credits.title'))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(parseEmoji(e.blurple_star))
        );

        return interaction.editReply({
            content: null,
            components: [container, row],
            flags: MessageFlags.IsComponentsV2
        });
        } catch (error) {
            logger.error("[botstats]:", error);
            return interaction.editReply({
                content: `${e.error} ${t('common:error_occurred')}`,
                components: [],
                flags: MessageFlags.Ephemeral
            });
        }
    },
    help: {
        name: "botstats",
        description: "Display bot statistics",
        category: "Bot",
        permissions: [],
        botPermissions: [],
        created: 1764938508
    }
};

// contributors: @relentiousdragon