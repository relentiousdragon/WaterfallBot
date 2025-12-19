const { SlashCommandBuilder, MessageFlags, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();

function decodeHtmlEntities(str) {
    if (!str || typeof str !== "string") return str;
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'");
}

function normalizeMotd(m) {
    if (!m) return null;
    let t = null;
    if (Array.isArray(m)) t = m.join("\n");
    else if (typeof m === "object" && m.clean) {
        if (Array.isArray(m.clean)) t = m.clean.join("\n");
        else t = String(m.clean);
    } else t = String(m);
    return decodeHtmlEntities(t).trim();
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
                .addStringOption(o => o.setName("address").setDescription("IP Address").setDescriptionLocalizations(commandMeta.minecraft.option_address).setRequired(true))
                .addStringOption(o =>
                    o.setName("edition")
                        .setDescription("Edition")
                        .setDescriptionLocalizations(commandMeta.minecraft.option_edition)
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
                .addStringOption(o => o.setName("username").setDescription("Username/UUID").setDescriptionLocalizations(commandMeta.minecraft.option_username).setRequired(true))
                .addStringOption(o =>
                    o.setName("type")
                        .setDescription("Render type")
                        .setDescriptionLocalizations(commandMeta.minecraft.option_type)
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
                    const motd = normalizeMotd(d.motd ?? d.motd?.clean ?? d.motd?.raw);
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
                                new TextDisplayBuilder().setContent(`-# ${isOnline ? `${e.green_point} **ONLINE**` : `${e.red_point} **OFFLINE**`}`)
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

            const base = "https://crafatar.com";
            let img;

            if (type === "headshot") img = `${base}/avatars/${p.uuid}.png?size=256&overlay`;
            if (type === "full-body") img = `${base}/renders/body/${p.uuid}.png?scale=10&overlay`;
            if (type === "skin") img = `${base}/skins/${p.uuid}`;
            if (type === "head") img = `${base}/renders/head/${p.uuid}.png?scale=10&overlay`;
            if (type === "cape") img = `${base}/capes/${p.uuid}.png`;

            const thumbURL = interaction.client.user.displayAvatarURL({ size: 64 });

            const container = [
                new ContainerBuilder()
                    .setAccentColor(0x4bbf6a)
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbURL))
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${p.name}`),
                                new TextDisplayBuilder().setContent(`-# ${type.replace("-", " ")}`)
                            )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addMediaGalleryComponents(
                        new MediaGalleryBuilder()
                            .addItems(
                                new MediaGalleryItemBuilder().setURL(img)
                            )
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                    .addActionRowComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands:minecraft.download_skin')).setURL(p.skin)
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