const { SlashCommandBuilder, MessageFlags, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const { decodeHtmlEntities } = require("../../util/functions.js");

function normalizeMotd(m) {
    if (!m) return null;
    let t = null;
    if (Array.isArray(m)) {
        t = m.join("\n");
    } else if (typeof m === "object") {
        const val = m.clean ?? m.raw ?? m.html;
        if (val !== undefined && val !== null) {
            if (Array.isArray(val)) t = val.join("\n");
            else t = String(val);
        } else {
            t = String(m);
        }
    } else {
        t = String(m);
    }
    return t ? decodeHtmlEntities(t).trim() : null;
}

function base64ToAttachment(base64, name = 'image.png') {
    const cleaned = base64.includes('base64,') ? base64.split('base64,')[1] : base64;
    const buffer = Buffer.from(cleaned, 'base64');
    return new AttachmentBuilder(buffer, { name });
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("minecraft")
        .setNameLocalizations(commandMeta.minecraft.name)
        .setDescription("Minecraft utilities")
        .setDescriptionLocalizations(commandMeta.minecraft.description)
        .addSubcommand(sub =>
            sub.setName("server")
                .setNameLocalizations(commandMeta.minecraft.server_name)
                .setDescription("Get the status of a Minecraft Server")
                .setDescriptionLocalizations(commandMeta.minecraft.server_description)
                .addStringOption(o => o.setName("address").setNameLocalizations(commandMeta.minecraft.option_address_name || {}).setDescription("IP Address").setDescriptionLocalizations(commandMeta.minecraft.option_address_description || {}).setRequired(true))
                .addStringOption(o =>
                    o.setName("edition")
                        .setNameLocalizations(commandMeta.minecraft.option_edition_name || {})
                        .setDescription("Edition")
                        .setDescriptionLocalizations(commandMeta.minecraft.option_edition_description || {})
                        .addChoices(
                            { name: "Java", value: "java", name_localizations: commandMeta.minecraft.edition_java },
                            { name: "Bedrock", value: "bedrock", name_localizations: commandMeta.minecraft.edition_bedrock }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName("skin")
                .setNameLocalizations(commandMeta.minecraft.skin_name)
                .setDescription("Get the skin of a Minecraft player")
                .setDescriptionLocalizations(commandMeta.minecraft.skin_description)
                .addStringOption(o => o.setName("username").setNameLocalizations(commandMeta.minecraft.option_username_name || {}).setDescription("Username/UUID").setDescriptionLocalizations(commandMeta.minecraft.option_username_description || {}).setRequired(true))
                .addStringOption(o =>
                    o.setName("type")
                        .setNameLocalizations(commandMeta.minecraft.option_type_name || {})
                        .setDescription("Render type")
                        .setDescriptionLocalizations(commandMeta.minecraft.option_type_description || {})
                        .addChoices(
                            { name: "Headshot", value: "headshot", name_localizations: commandMeta.minecraft.type_headshot },
                            { name: "Full Body", value: "full-body", name_localizations: commandMeta.minecraft.type_full_body },
                            { name: "Skin File", value: "skin", name_localizations: commandMeta.minecraft.type_skin },
                            { name: "3D Head", value: "head", name_localizations: commandMeta.minecraft.type_head },
                            { name: "Cape", value: "cape", name_localizations: commandMeta.minecraft.type_cape }
                        )
                        .setRequired(true)
                )
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const sub = interaction.options.getSubcommand();

        if (sub === "server") {
            await interaction.deferReply();
            const host = interaction.options.getString("address");
            const edition = interaction.options.getString("edition") || "java";

            const getStatus = async u => {
                try {
                    const r = await axios.get(u, { timeout: 8000 });
                    const d = r.data || {};
                    const online = d.online === true || (d.players && d.players.online !== undefined);
                    const max = d.players?.max ?? 0;
                    const on = d.players?.online ?? 0;
                    const ver = d.version?.name ?? d.version ?? d.software ?? "Unknown";
                    const proto = d.protocol?.version ?? d.protocol ?? "Unknown";
                    const motd = normalizeMotd(d.motd?.clean ?? d.motd?.raw ?? d.motd);
                    const icon = d.icon || null;
                    return { online, max, on, ver, proto, motd, icon };
                } catch {
                    return null;
                }
            };

            const link = edition === "java"
                ? `https://api.mcsrvstat.us/3/${host}`
                : `https://api.mcsrvstat.us/bedrock/3/${host}`;
            const s = await getStatus(link);

            if (!s) {
                const container = [
                    new ContainerBuilder()
                        .setAccentColor(0xff5555)
                        .addSectionComponents(
                            new SectionBuilder()
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder().setURL(interaction.client.user.displayAvatarURL({ size: 64 }))
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${t('commands:minecraft.server_unreachable')}`),
                                    new TextDisplayBuilder().setContent(`-# ${t('commands:minecraft.could_not_reach')}`)
                                )
                        )
                ];
                return interaction.editReply({ components: container, flags: MessageFlags.IsComponentsV2 });
            }

            let isOnline = s.online;
            if (s.online === true) {
                if ((s.ver && s.ver.toLowerCase().includes('offline')) || s.proto === -1) {
                    isOnline = false;
                }
            }

            const thumbAttachment = s.icon?.startsWith("data:image/") ? base64ToAttachment(s.icon, 'servericon.png') : null;
            const thumbURL = thumbAttachment ? "attachment://servericon.png" : s.icon || interaction.client.user.displayAvatarURL({ size: 64 });

            const container = [
                new ContainerBuilder()
                    .setAccentColor(isOnline ? 0x00ff55 : 0xff4444)
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbURL))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${host}`),
                                new TextDisplayBuilder().setContent(`-# ${isOnline ? `${e.green_point} **${t('common:online')}**` : `${e.red_point} **${t('common:offline')}**`}`)
                            )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`${t('commands:minecraft.players')}: **${s.on}/${s.max}**`),
                        new TextDisplayBuilder().setContent(`${t('commands:minecraft.version')}: **${s.ver}**`),
                        new TextDisplayBuilder().setContent(`${t('commands:minecraft.protocol')}: **${s.proto}**\n\`\`\`ansi\n${s.motd}\n\`\`\``)
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# Waterfall - ${t('commands:minecraft.status')}`)
                    )
            ];

            const files = thumbAttachment ? [thumbAttachment] : [];
            return interaction.editReply({
                components: container,
                files,
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (sub === "skin") {
            await interaction.deferReply();
            const username = interaction.options.getString("username");
            const type = interaction.options.getString("type");

            const resolve = async id => {
                try {
                    const r = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${id}`, { timeout: 7000 });
                    if (!r.data?.id) return null;
                    const uuid = r.data.id;
                    return { uuid, name: r.data.name, skin: `https://crafatar.com/skins/${uuid}` };
                } catch {
                    return null;
                }
            };

            const p = await resolve(username);
            if (!p) return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:minecraft.unknown_player')}` });

            const getCrafatarUrl = (type, uuid) => {
                const base = "https://crafatar.com";
                switch (type) {
                    case "headshot": return `${base}/avatars/${uuid}.png?size=256&overlay`;
                    case "full-body": return `${base}/renders/body/${uuid}.png?scale=10&overlay`;
                    case "skin": return `${base}/skins/${uuid}`;
                    case "head": return `${base}/renders/head/${uuid}.png?scale=10&overlay`;
                    case "cape": return `${base}/capes/${uuid}.png`;
                    default: return null;
                }
            };

            const getMineskinUrls = (type, uuid) => {
                const base = "https://mineskin.eu";
                switch (type) {
                    case "headshot":
                        return [
                            `${base}/helm/${uuid}/256.png`,
                            `${base}/avatar/${uuid}/256.png`
                        ];
                    case "full-body":
                        return [
                            `${base}/armor/body/${uuid}/100.png`,
                            `${base}/body/${uuid}/100.png`
                        ];
                    case "skin":
                        return [`${base}/skin/${uuid}`];
                    case "head":
                        return [
                            `${base}/headhelm/${uuid}/100.png`,
                            `${base}/head/${uuid}/100.png`
                        ];
                    case "cape": return [];
                    default: return [];
                }
            };

            let images = [];
            let downloadUrl = `https://crafatar.com/skins/${p.uuid}`;
            let source = "Crafatar";

            if (type === "cape") {
                try {
                    const r = await axios.get(`https://starlightskins.lunareclipse.studio/info/user/${p.uuid}`, { timeout: 7500 });
                    if (r.data?.userCape) {
                        images = [r.data.userCape];
                        downloadUrl = r.data.userCape;
                        source = "Starlight";
                    } else {
                        return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:minecraft.no_cape')}` });
                    }
                } catch (err) {
                    logger.debug(`[Minecraft] Starlight API failed for cape: ${err.message}`);
                    return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:minecraft.cape_fetch_error')}` });
                }
            } else {
                const crafatarImg = getCrafatarUrl(type, p.uuid);
                try {
                    if (!crafatarImg) throw new Error("Invalid type for Crafatar");
                    await axios.head(crafatarImg, { timeout: 1500 });
                    images.push(crafatarImg);
                } catch (err) {
                    source = "Mineskin";
                    const mineskinUrls = getMineskinUrls(type, p.uuid);
                    if (mineskinUrls.length > 0) {
                        images = mineskinUrls;
                        downloadUrl = `https://mineskin.eu/download/${p.uuid}`;
                        logger.debug(`[Minecraft] Crafatar unreachable, using Mineskin fallback for ${type}`);
                    }
                }
            }

            if (images.length === 0) {
                return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:minecraft.skin_fetch_error') || "Could not fetch skin."}` });
            }

            const thumbURL = interaction.client.user.displayAvatarURL({ size: 64 });
            const gallery = new MediaGalleryBuilder();

            for (const img of images) {
                gallery.addItems(new MediaGalleryItemBuilder().setURL(img));
            }

            const container = [
                new ContainerBuilder()
                    .setAccentColor(0x4bbf6a)
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbURL))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${p.name}`),
                                new TextDisplayBuilder().setContent(`-# ${type.replace("-", " ")} (${source})`)
                            )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(gallery)
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands:minecraft.download_skin')).setURL(downloadUrl)
                            )
                    )
            ];

            return interaction.editReply({
                components: container,
                flags: MessageFlags.IsComponentsV2
            });
        }
    },
    help: {
        name: "minecraft",
        description: "Minecraft utilities",
        category: "Utility",
        permissions: [],
        botPermissions: [],
        created: 1765271948
    }
};

// contributors: @relentiousdragon