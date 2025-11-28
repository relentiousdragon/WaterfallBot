const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, MessageFlags, Routes } = require('discord.js');
const e = require("../../data/emoji.js");

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
        .addUserOption(opt => opt.setName('target').setDescription('User to view'))
        .setDMPermission(true),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('target') || interaction.user;
            const user = await bot.rest.get(Routes.user(target.id)).catch(() => null);

            if (!user) return interaction.editReply({ content: `${e.pixel_cross} User not found`, flags: MessageFlags.Ephemeral });

            const flags = user.public_flags !== null ? user.public_flags : user.flags;
            let badges = translateFlags(flags);

            let badgeArray = badges ? badges.split(' ') : [];

            if (settings.devs.includes(target.id)) {
                badgeArray.push(`${e.badge_dev1}${e.badge_dev2}${e.badge_dev3}`);
            } else if (settings.moderators.includes(target.id)) {
                badgeArray.push(`${e.badge_moderator1}${e.badge_moderator2}${e.badge_moderator3}${e.badge_moderator4}${e.badge_moderator5}`);
            } else if (settings.testers.includes(target.id)) {
                badgeArray.push(`${e.badge_tester1}${e.badge_tester2}${e.badge_tester3}${e.badge_tester4}`);
            }

            let isBoosting = false;
            let member;
            if (interaction.guild) {
                member = interaction.options.getMember('target') || interaction.member;
                if (member && (member.premiumSince || member.premiumSinceTimestamp)) {
                    isBoosting = true;
                }
            }

            let titleSuffix = ' Information';
            if (target.bot) {
                let verified = false;
                if (flags & 65536) {
                    verified = true;
                }

                titleSuffix = verified
                    ? ` ${e.discord_verifiedApp1}${e.discord_verifiedApp2}${e.discord_verifiedApp3}`
                    : ` ${e.discord_app1}${e.discord_app2}`;
            }

            let title = `${target.username}${isBoosting ? ` ${e.blurple_boost}` : `${titleSuffix}`}`;

            if (target.id === bot.user.id) {
                title += "\n-# A Real Waterfall.";
            }

            let usernameDisplay = target.username;
            if (target.discriminator && target.discriminator !== '0') {
                usernameDisplay += `#${target.discriminator}`;
            }

            const hexAccentColor = user.accent_color ? `#${user.accent_color.toString(16).padStart(6, '0')}` : (target.hexAccentColor || 0x5865F2);

            const embed = new EmbedBuilder()
                .setColor(hexAccentColor)
                .setTitle(title)
                .setThumbnail(target.displayAvatarURL({ size: 2048 }));

            const fields = [
                { name: 'Username & ID', value: `${usernameDisplay} | ${target.id}` },
                { name: '\u200B', value: '\u200B' },
                { name: 'Created Date', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>` }
            ];

            let clanTag;
            if (user.clan) {
                clanTag = user.clan.tag;
            }

            if (clanTag) {
                fields.push({
                    name: 'Clan',
                    value: `\`[${clanTag}]\``
                });
            }

            if (badgeArray.length) {
                fields.push({ name: 'Badges', value: badgeArray.join(' ') });
            }

            if (interaction.guild && member) {
                fields.push({ name: 'Joined Date', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` });
            }

            embed.addFields(fields)
                .setTimestamp()
                .setFooter({ text: `Waterfall Bot`, iconURL: bot.user.displayAvatarURL({ size: 2048 }) });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Avatar Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(target.displayAvatarURL({ size: 2048 }))
                );

            if (user.banner) {
                const bannerURL = `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${user.banner.startsWith('a_') ? 'gif' : 'png'}?size=2048`;
                embed.setImage(bannerURL);
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel('Banner Link')
                        .setStyle(ButtonStyle.Link)
                        .setURL(bannerURL)
                );
            }

            return interaction.editReply({ embeds: [embed], components: [row] });

        } catch (error) {
            logger.error("Error executing command:", error);
            return interaction.editReply({ content: `${e.pixel_cross} An error occurred while executing the command.`, flags: MessageFlags.Ephemeral });
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
