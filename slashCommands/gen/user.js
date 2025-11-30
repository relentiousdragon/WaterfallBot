const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, MessageFlags, Routes, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const e = require("../../data/emoji.js");

const commandMeta = require("../../util/i18n.js").getCommandMetadata;
const FLAG_MASKS = {
    1: e.blurple_staff,
    2: e.blurple_partner,
    4: e.discord_hypesquad_events,
    8: e.discord_bughunter,
    64: e.discord_hypesquad_bravery,
    128: e.discord_hypesquad_brilliance,
    256: e.discord_hypesquad_balance,
    512: e.discord_early_supporter,
    16384: e.discord_golden_bughunter,
    131072: e.discord_early_verified_developer,
    262144: e.discord_moderator_program_alumni,
    4194304: e.discord_active_developer,
};

function translateFlags(flagsInt) {
    const badges = [];
    for (const [mask, emoji] of Object.entries(FLAG_MASKS)) {
        if (flagsInt & Number(mask)) badges.push(emoji);
    }
    return badges.length ? badges.join(' ') : '';
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('Get information about a user')
        .setNameLocalizations(commandMeta.user.name)
        .setDescriptionLocalizations(commandMeta.user.description)
        .addUserOption(opt => opt.setName('target').setDescription('User to view'))
        .setDMPermission(true),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('target') || interaction.user;
            const user = await bot.rest.get(Routes.user(target.id)).catch(() => null);

            if (!user) return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:user.not_found')}`, flags: MessageFlags.Ephemeral });

            const flags = user.public_flags !== null ? user.public_flags : user.flags;
            let badges = translateFlags(flags);

            let badgeArray = badges ? badges.split(' ') : [];

            let botBadges = '';
            if (settings.devs.includes(target.id)) {
                botBadges = `${e.badge_dev1}${e.badge_dev2}${e.badge_dev3}`;
            } else if (settings.moderators.includes(target.id)) {
                botBadges = `${e.badge_moderator1}${e.badge_moderator2}${e.badge_moderator3}${e.badge_moderator4}${e.badge_moderator5}`;
            } else if (settings.testers.includes(target.id)) {
                botBadges = `${e.badge_tester1}${e.badge_tester2}${e.badge_tester3}${e.badge_tester4}`;
            }

            let isBoosting = false;
            let member;
            if (interaction.guild) {
                member = interaction.options.getMember('target') || interaction.member;
                if (member && (member.premiumSince || member.premiumSinceTimestamp)) {
                    isBoosting = true;
                }
            }

            //let titleSuffix = ' Information';
            let titleSuffix = '';
            if (target.bot) {
                let verified = false;
                if (flags & 65536) {
                    verified = true;
                }

                titleSuffix = verified
                    ? ` ${e.discord_verifiedApp1}${e.discord_verifiedApp2}${e.discord_verifiedApp3}`
                    : ` ${e.discord_app1}${e.discord_app2}`;
            }

            let title = `${t('commands:user.about', { user: `[${target.displayName}](https://discord.com/users/${target.id})` })}${isBoosting ? ` ${e.blurple_boost}` : `${titleSuffix}`}`;

            if (target.id === bot.user.id) {
                title += `\n-# ${t('commands:user.waterfall_tag')} ${e.verified_check_bw}`;
            }

            if (botBadges) {
                title += `\n-# ${botBadges}`;
            }

            let usernameDisplay = target.username;
            if (target.discriminator && target.discriminator !== '0') {
                usernameDisplay += `#${target.discriminator}`;
            }

            let accentColor = 0x5865F2;
            if (member && member.displayColor !== 0) {
                accentColor = member.displayColor;
            } else if (user.accent_color) {
                accentColor = user.accent_color;
            }

            const section = new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(target.displayAvatarURL({ size: 2048 })))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${title}`)
                );

            const container = new ContainerBuilder()
                .setAccentColor(accentColor)
                .addSectionComponents(section)
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                );

            let description = `### ${t('commands:user.username_id')}\n${usernameDisplay} | ${target.id}\n\n### ${t('commands:user.created_date')}\n<t:${Math.floor(target.createdTimestamp / 1000)}:F>`;

            let clanTag;
            if (user.clan) {
                clanTag = user.clan.tag;
            }

            if (clanTag) {
                description += `\n\n### ${t('commands:user.clan')}\n\`[${clanTag}]\``;
            }

            if (badgeArray.length) {
                description += `\n\n### ${t('commands:user.badges')}\n${badgeArray.join(' ')}`;
            }

            if (interaction.guild && member) {
                description += `\n\n### ${t('commands:user.joined_date')}\n<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`;
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel(t('commands:user.avatar_link'))
                        .setStyle(ButtonStyle.Link)
                        .setURL(target.displayAvatarURL({ size: 2048 }))
                );

            if (user.banner) {
                const bannerURL = `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${user.banner.startsWith('a_') ? 'gif' : 'png'}?size=2048`;

                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(bannerURL)
                    )
                );

                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(t('commands:user.banner_link'))
                        .setStyle(ButtonStyle.Link)
                        .setURL(bannerURL)
                );
            }

            container.addActionRowComponents(row);

            return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('common.error')}`, flags: MessageFlags.Ephemeral });
        }
    },
    help: {
        name: "user",
        description: "Get information about a user",
        category: "General",
        permissions: [],
        botPermissions: []
    }
};
