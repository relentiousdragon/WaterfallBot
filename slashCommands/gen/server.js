const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ChannelType } = require('discord.js');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const funcs = require("../../util/functions.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Get information about the current server')
        .setNameLocalizations(commandMeta.server?.name || {})
        .setDescriptionLocalizations(commandMeta.server?.description || {})
        .setDMPermission(false),
    integration_types: [0],
    contexts: [0],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply();

            const guild = interaction.guild;
            if (!guild) return interaction.editReply({ content: t('common:error'), flags: MessageFlags.Ephemeral });

            const owner = await guild.fetchOwner().catch(() => null);

            const totalMembers = guild.memberCount;
            const botMembers = guild.members.cache.filter(m => m.user.bot).size;
            const humanMembers = totalMembers - botMembers;

            const channels = guild.channels.cache;
            const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
            const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
            const categoryChannels = channels.filter(c => c.type === ChannelType.GuildCategory).size;

            let title = `${t('commands:user.about', { user: `${guild.name}` })}`;
            if (guild.premiumTier > 0) {
                title += ` ${e.blurple_boost} - ${t('commands:server.level', { level: guild.premiumTier })}`;
            }

            const container = new ContainerBuilder()
                .setAccentColor(0x5865F2);

            if (guild.icon) {
                const section = new SectionBuilder()
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(guild.iconURL({ size: 2048 })))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# ${title}`)
                    );
                container.addSectionComponents(section);
            } else {
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${title}`)
                );
            }

            if (guild.banner) {
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(guild.bannerURL({ size: 2048 }))
                    )
                );
            }

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            );

            let description = `### ${t('commands:server.name_id')}\n${guild.name} | ${guild.id}\n\n`;
            description += `### ${t('commands:server.owner')}\n${owner ? `${owner.user.username} (${owner.id})` : 'Unknown'}\n\n`;
            description += `### ${t('commands:server.members')}\n${e.member} ${t('common:total')}: ${totalMembers}\n${e.reply_cont} ${t('commands:server.humans')}: ${humanMembers}\n${e.reply} ${t('commands:server.bots')}: ${botMembers}\n\n`;
            description += `### ${t('commands:server.channels')}\n${e.channel} ${t('common:total')}: ${channels.size}\n${e.reply} Text: ${textChannels} | Voice: ${voiceChannels} | Categories: ${categoryChannels}\n\n`;
            description += `### ${t('commands:server.boosts')}\n${e.blurple_boost} ${guild.premiumSubscriptionCount || 0} ${t('commands:server.boosts')}\n\n`;
            description += `### ${t('commands:server.created_date')}\n<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            const row = new ActionRowBuilder();
            if (guild.icon) {
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(t('commands:server.icon_link'))
                        .setStyle(ButtonStyle.Link)
                        .setURL(guild.iconURL({ size: 2048 }))
                );
            }
            if (guild.banner) {
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(t('commands:server.banner_link'))
                        .setStyle(ButtonStyle.Link)
                        .setURL(guild.bannerURL({ size: 2048 }))
                );
            }

            if (row.components.length > 0) {
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                );
                container.addActionRowComponents(row);
            }

            return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            logger.error("[/SERVER] Error executing command:", error);
            const errorContainer = new ContainerBuilder()
                .setAccentColor(0x5865F2)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${e.pixel_cross} ${t('common:error')}`)
                );
            return interaction.editReply({
                components: [errorContainer],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
            });
        }
    },
    help: {
        name: "server",
        description: "Get information about the current server",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1766228122
    }
};
