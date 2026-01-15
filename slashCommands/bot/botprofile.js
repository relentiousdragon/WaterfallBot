const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { Server } = require("../../schemas/servers.js");
const path = require("path");
const fs = require("fs");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("botprofile")
        .setNameLocalizations(commandMeta.botprofile.name || {})
        .setDescription("Change the bot's profile for this server")
        .setDescriptionLocalizations(commandMeta.botprofile.description || {})
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName("profile")
                .setNameLocalizations(commandMeta.botprofile.option_profile_name || {})
                .setDescription("The profile theme to apply")
                .setDescriptionLocalizations(commandMeta.botprofile.option_profile_description || {})
                .setRequired(true)
                .addChoices(
                    { name: "Default", value: "default" },
                    { name: "Crimson", value: "crimson" },
                    { name: "Azure", value: "azure" },
                    { name: "Amethyst", value: "amethyst" },
                    { name: "Amethyst (Glow)", value: "amethyst_glow" },
                    { name: "Sea Breeze", value: "sea_breeze" }
                )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const profile = interaction.options.getString("profile");
        const guildId = interaction.guild.id;

        const assetsDir = path.join(__dirname, "../../assets");
        const profiles = {
            default: {
                avatar: "Waterfall_avatar.webp",
                banner: "Waterfall_banner.png"
            },
            crimson: {
                avatar: "Waterfall_avatar2_red.png",
                banner: "Waterfall_banner2_red.png"
            },
            azure: {
                avatar: "Waterfall_avatar2_blue.png",
                banner: "Waterfall_banner2_blue.png"
            },
            amethyst: {
                avatar: "Waterfall_avatar2_amethyst.png",
                banner: "Waterfall_banner2_amethyst.png"
            },
            amethyst_glow: {
                avatar: "Waterfall_avatar2_amethyst_glow.png",
                banner: "Waterfall_banner2_amethyst.png"
            },
            sea_breeze: {
                avatar: "Waterfall_avatar2_seabreeze2.png",
                banner: "Waterfall_banner2_seabreeze2.png"
            }
        };

        const selected = profiles[profile];
        if (!selected) {
            return interaction.reply({ content: "Invalid profile selected.", flags: MessageFlags.Ephemeral });
        }

        const profileNames = {
            default: "Default",
            crimson: "Crimson",
            azure: "Azure",
            amethyst: "Amethyst",
            amethyst_glow: "Amethyst (Glow)",
            sea_breeze: "Sea Breeze"
        };

        const COOLDOWN = 600000;
        try {
            const serverData = await Server.findOne({ serverID: guildId });
            if (serverData) {
                if (serverData.botProfile === profile) {
                    const formattedProfile = profileNames[profile] || (profile.charAt(0).toUpperCase() + profile.slice(1));
                    return interaction.reply({
                        content: t("commands:botprofile.already_set", { profile: formattedProfile }),
                        flags: MessageFlags.Ephemeral
                    });
                }
                if (serverData.botProfileLastUpdate) {
                    const diff = Date.now() - serverData.botProfileLastUpdate;
                    if (diff < COOLDOWN) {
                        const nextUpdate = Math.floor((serverData.botProfileLastUpdate + COOLDOWN) / 1000);
                        return interaction.reply({
                            content: t("commands:botprofile.cooldown", { time: `<t:${nextUpdate}:R>` }),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }
        } catch (err) { logger.error("[BotProfile] Cooldown check failed:", err); }

        await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

        try {
            const avatarPath = path.join(assetsDir, selected.avatar);
            const bannerPath = path.join(assetsDir, selected.banner);

            let avatarDataUri = null;
            let bannerDataUri = null;

            try {
                if (fs.existsSync(avatarPath)) {
                    const avatarBuffer = fs.readFileSync(avatarPath);
                    const ext = path.extname(avatarPath).substring(1);
                    avatarDataUri = `data:image/${ext};base64,${avatarBuffer.toString('base64')}`;
                }
                if (fs.existsSync(bannerPath)) {
                    const bannerBuffer = fs.readFileSync(bannerPath);
                    const ext = path.extname(bannerPath).substring(1);
                    bannerDataUri = `data:image/${ext};base64,${bannerBuffer.toString('base64')}`;
                }
            } catch (fileErr) {
                logger.error(`[BotProfile] Failed to read assets for ${profile}:`, fileErr);
                return interaction.editReply({ content: `Error: Could not find asset files for ${profile}.` });
            }

            logger.debug(`[BotProfile] Sending PATCH to /guilds/${guildId}/members/@me for profile ${profile}`);

            await interaction.client.rest.patch(`/guilds/${guildId}/members/@me`, {
                body: {
                    avatar: avatarDataUri,
                    banner: bannerDataUri
                },
                reason: `Bot profile changed to ${profile} by ${interaction.user.tag}`
            });

            await Server.findOneAndUpdate(
                { serverID: guildId },
                { botProfile: profile, botProfileLastUpdate: Date.now() },
                { upsert: true }
            );

            const formattedProfile = profileNames[profile] || (profile.charAt(0).toUpperCase() + profile.slice(1));

            await interaction.editReply({
                content: t("commands:botprofile.success", { profile: formattedProfile })
            });

        } catch (error) {
            logger.error("[BotProfile] Error updating profile:", error);

            const apiMsg = error.message || error.rawError?.message;

            if (apiMsg && apiMsg.includes("AVATAR_RATE_LIMIT")) {
                return interaction.editReply({ content: t("commands:botprofile.rate_limited") });
            }

            return interaction.editReply({ content: t("commands:botprofile.error") });
        }
    },
    help: {
        name: "botprofile",
        description: "Change the bot's profile picture and banner for the current server",
        category: "Bot",
        permissions: ["Administrator"],
        botPermissions: [],
        created: 1766749709
    },
    async handleButtonInteraction(bot, interaction, t, logger) {
        const customId = interaction.customId;
        if (!customId.startsWith('botprofile_select_')) return;

        const profile = customId.replace('botprofile_select_', '');
        const guildId = interaction.guild?.id;

        if (!guildId) {
            return interaction.reply({
                content: t("common:error"),
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: t("common:no_permission"),
                flags: MessageFlags.Ephemeral
            });
        }

        const profiles = {
            default: { avatar: "Waterfall_avatar.webp", banner: "Waterfall_banner.png" },
            crimson: { avatar: "Waterfall_avatar2_red.png", banner: "Waterfall_banner2_red.png" },
            azure: { avatar: "Waterfall_avatar2_blue.png", banner: "Waterfall_banner2_blue.png" },
            amethyst: { avatar: "Waterfall_avatar2_amethyst_glow.png", banner: "Waterfall_banner2_amethyst.png" },
            seabreeze: { avatar: "Waterfall_avatar2_seabreeze2.png", banner: "Waterfall_banner2_seabreeze2.png" }
        };

        const profileNames = {
            default: "Default",
            crimson: "Crimson",
            azure: "Azure",
            amethyst: "Amethyst",
            seabreeze: "Sea Breeze"
        };

        const selected = profiles[profile];
        if (!selected) {
            return interaction.reply({
                content: t("common:error"),
                flags: MessageFlags.Ephemeral
            });
        }

        const COOLDOWN = 600000;
        try {
            const serverData = await Server.findOne({ serverID: guildId });
            if (serverData) {
                if (serverData.botProfile === profile) {
                    const formattedProfile = profileNames[profile] || profile;
                    return interaction.reply({
                        content: t("commands:botprofile.already_set", { profile: formattedProfile }),
                        flags: MessageFlags.Ephemeral
                    });
                }
                if (serverData.botProfileLastUpdate) {
                    const diff = Date.now() - serverData.botProfileLastUpdate;
                    if (diff < COOLDOWN) {
                        const nextUpdate = Math.floor((serverData.botProfileLastUpdate + COOLDOWN) / 1000);
                        return interaction.reply({
                            content: t("commands:botprofile.cooldown", { time: `<t:${nextUpdate}:R>` }),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }
        } catch (err) {
            logger.error("[BotProfile] Cooldown check failed:", err);
        }

        await interaction.deferUpdate();

        try {
            const assetsDir = path.join(__dirname, "../../assets");
            const avatarPath = path.join(assetsDir, selected.avatar);
            const bannerPath = path.join(assetsDir, selected.banner);

            let avatarDataUri = null;
            let bannerDataUri = null;

            if (fs.existsSync(avatarPath)) {
                const avatarBuffer = fs.readFileSync(avatarPath);
                const ext = path.extname(avatarPath).substring(1);
                avatarDataUri = `data:image/${ext};base64,${avatarBuffer.toString('base64')}`;
            }
            if (fs.existsSync(bannerPath)) {
                const bannerBuffer = fs.readFileSync(bannerPath);
                const ext = path.extname(bannerPath).substring(1);
                bannerDataUri = `data:image/${ext};base64,${bannerBuffer.toString('base64')}`;
            }

            await interaction.client.rest.patch(`/guilds/${guildId}/members/@me`, {
                body: { avatar: avatarDataUri, banner: bannerDataUri },
                reason: `Bot profile changed to ${profile} by ${interaction.user.tag}`
            });

            await Server.findOneAndUpdate(
                { serverID: guildId },
                { botProfile: profile, botProfileLastUpdate: Date.now() },
                { upsert: true }
            );

            const { ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
            const { settings } = require("../../util/settingsModule.js");

            const a = settings.a_emojis || {};
            const formatEmoji = (id) => id && id !== "?" ? `<:a:${id}>` : "";

            const styleList = ["default", "crimson", "azure", "amethyst", "seabreeze"];
            const styleDescriptions = {
                default: "Classic",
                crimson: "Neo: Fiery Red",
                azure: "Neo: Blue",
                amethyst: "Neo: Purple (Glow)",
                seabreeze: "Neo: Teal"
            };

            const container = new ContainerBuilder().setAccentColor(0x5865F2);
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent("# Choose your Waterfall!"),
                new TextDisplayBuilder().setContent(`-# ${t('events:welcome_message.choose_waterfall_subtitle')}`)
            );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

            for (const style of styleList) {
                const emojis12 = `${formatEmoji(a[`${style}_1`])}${formatEmoji(a[`${style}_2`])}`;
                const emojis34 = `${formatEmoji(a[`${style}_3`])}${formatEmoji(a[`${style}_4`])}`;
                const displayName = profileNames[style] || style;

                const isSelected = style === profile;
                const btnLabel = isSelected ? t('common:selected') : t('common:select');
                const btnStyle = isSelected ? ButtonStyle.Success : ButtonStyle.Primary;

                container.addSectionComponents(
                    new SectionBuilder()
                        .setButtonAccessory(
                            new ButtonBuilder()
                                .setCustomId(`botprofile_select_${style}`)
                                .setLabel(btnLabel)
                                .setStyle(btnStyle)
                                .setDisabled(true)
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                (emojis12 ? `${emojis12} ` : "") + `**${displayName}**\n` +
                                (emojis34 ? `${emojis34} ` : "") + styleDescriptions[style]
                            )
                        )
                );
            }

            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${t('events:welcome_message.style_cooldown_note')}\n-# ${t('events:welcome_message.more_styles_note')}`)
            );

            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("[BotProfile Button] Error updating profile:", error);

            const apiMsg = error.message || error.rawError?.message;
            if (apiMsg && apiMsg.includes("AVATAR_RATE_LIMIT")) {
                return interaction.followUp({
                    content: t("commands:botprofile.rate_limited"),
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.followUp({
                content: t("commands:botprofile.error"),
                flags: MessageFlags.Ephemeral
            });
        }
    },
    profiles: {
        default: { avatar: "Waterfall_avatar.webp", banner: "Waterfall_banner.png" },
        crimson: { avatar: "Waterfall_avatar2_red.png", banner: "Waterfall_banner2_red.png" },
        azure: { avatar: "Waterfall_avatar2_blue.png", banner: "Waterfall_banner2_blue.png" },
        amethyst: { avatar: "Waterfall_avatar2_amethyst_glow.png", banner: "Waterfall_banner2_amethyst.png" },
        seabreeze: { avatar: "Waterfall_avatar2_seabreeze2.png", banner: "Waterfall_banner2_seabreeze2.png" }
    },
    profileNames: {
        default: "Default",
        crimson: "Crimson",
        azure: "Azure",
        amethyst: "Amethyst",
        seabreeze: "Sea Breeze"
    }
};

// contributors: @relentiousdragon
