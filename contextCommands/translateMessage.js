const {
    ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags,
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, EmbedBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
    ButtonBuilder, ComponentType,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ActionRowBuilder, FileBuilder,
} = require("discord.js");
const e = require("../data/emoji.js");
const commandMeta = require("../util/i18n.js").getCommandMetadata();
const { LANGUAGES, LANG_FLAGS, discordLocaleToLang, getLanguageName, translateText, batchTranslateEntries, detectLanguage, collectEmbedText } = require("../util/translateHelper.js");

const TYPES = {
    ACTION_ROW: 1,
    BUTTON: 2,
    STRING_SELECT: 3,
    USER_SELECT: 5,
    ROLE_SELECT: 6,
    MENTIONABLE_SELECT: 7,
    CHANNEL_SELECT: 8,
    SECTION: 9,
    TEXT_DISPLAY: 10,
    THUMBNAIL: 11,
    MEDIA_GALLERY: 12,
    FILE: 13,
    SEPARATOR: 14,
    CONTAINER: 17,
};

const BTN_STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 };

const TRANSLATE_ICON_URL = 'https://images.icon-icons.com/1011/PNG/512/Google_Translate_icon-icons.com_75723.png';

const COLORS = {
    LOADING: 0x3b82f6,
    WARNING: 0xFEE75C,
    ERROR: 0xFF0000,
    NEUTRAL: 0x99AAB5,
};
//
function rebuildEmbed(translatedEmbed) {
    const embed = new EmbedBuilder();
    if (translatedEmbed.color != null) embed.setColor(translatedEmbed.color);
    if (translatedEmbed.title) embed.setTitle(String(translatedEmbed.title).slice(0, 256));
    if (translatedEmbed.description) embed.setDescription(String(translatedEmbed.description).slice(0, 4096));
    if (translatedEmbed.url) {
        try { embed.setURL(translatedEmbed.url); } catch (_) { /* */ }
    }
    if (translatedEmbed.timestamp) {
        try { embed.setTimestamp(new Date(translatedEmbed.timestamp)); } catch (_) { /* */ }
    }

    const thumbUrl = getMediaUrl(translatedEmbed.thumbnail);
    if (thumbUrl) {
        try { embed.setThumbnail(thumbUrl); } catch (_) { /* */ }
    }
    const imgUrl = getMediaUrl(translatedEmbed.image);
    if (imgUrl) {
        try { embed.setImage(imgUrl); } catch (_) { /* */ }
    }
    const vidUrl = getMediaUrl(translatedEmbed.video);
    if (vidUrl) {
        try { embed.setVideo(vidUrl); } catch (_) { /* */ }
    }

    if (translatedEmbed.author?.name) {
        const authorObj = { name: String(translatedEmbed.author.name).slice(0, 256) };
        if (translatedEmbed.author.url) authorObj.url = translatedEmbed.author.url;
        const authorIcon = prop(translatedEmbed.author, 'icon_url', 'iconURL');
        if (authorIcon) authorObj.iconURL = authorIcon;
        try { embed.setAuthor(authorObj); } catch (_) { /* */ }
    }
    if (translatedEmbed.footer?.text) {
        const footerObj = { text: String(translatedEmbed.footer.text).slice(0, 2048) };
        const footerIcon = prop(translatedEmbed.footer, 'icon_url', 'iconURL');
        if (footerIcon) footerObj.iconURL = footerIcon;
        try { embed.setFooter(footerObj); } catch (_) { /* */ }
    }
    if (translatedEmbed.fields && translatedEmbed.fields.length > 0) {
        const validFields = translatedEmbed.fields
            .filter(f => f.name && f.value)
            .slice(0, 25)
            .map(f => ({
                name: String(f.name).slice(0, 256),
                value: String(f.value).slice(0, 1024),
                inline: f.inline ?? false,
            }));
        if (validFields.length > 0) embed.addFields(...validFields);
    }
    return embed;
}

async function processEmbed(embedData, sourceLang, targetLang) {
    const entries = collectEmbedText(embedData);
    if (entries.length === 0) return rebuildEmbed(embedData);

    const translated = await batchTranslateEntries(entries, sourceLang, targetLang);
    const t = (key) => translated.get(key);

    const newEmbed = {
        color: embedData.color ?? undefined,
        title: t('title') || embedData.title,
        description: t('description') || embedData.description,
        url: embedData.url,
        timestamp: embedData.timestamp,
        thumbnail: embedData.thumbnail ? { url: getMediaUrl(embedData.thumbnail) } : undefined,
        image: embedData.image ? { url: getMediaUrl(embedData.image) } : undefined,
        video: embedData.video ? { url: getMediaUrl(embedData.video) } : undefined,
    };

    if (embedData.author) {
        newEmbed.author = {
            name: t('author.name') || embedData.author.name,
            url: embedData.author.url,
        };
        const authorIcon = prop(embedData.author, 'icon_url', 'iconURL');
        if (authorIcon) newEmbed.author.icon_url = authorIcon;
    }

    if (embedData.footer) {
        newEmbed.footer = {
            text: t('footer.text') || embedData.footer.text,
        };
        const footerIcon = prop(embedData.footer, 'icon_url', 'iconURL');
        if (footerIcon) newEmbed.footer.icon_url = footerIcon;
    }
    if (embedData.fields && embedData.fields.length > 0) {
        newEmbed.fields = embedData.fields.map((f, i) => ({
            name: t(`fields.${i}.name`) || f.name || '\u200B',
            value: t(`fields.${i}.value`) || f.value || '\u200B',
            inline: f.inline ?? false,
        }));
    }

    return rebuildEmbed(newEmbed);
}


function prop(obj, ...names) {
    for (const name of names) {
        if (obj != null && obj[name] !== undefined) return obj[name];
    }
    return undefined;
}

function getMediaUrl(media) {
    if (!media) return null;
    if (typeof media === 'string') return media;
    return prop(media, 'url') || null;
}

function collectComponentText(components) {
    const entries = [];

    function collectSectionText(comp, prefix) {
        const secChildren = comp.components || [];
        for (let sci = 0; sci < secChildren.length; sci++) {
            const secChild = secChildren[sci];
            if (secChild.type === TYPES.TEXT_DISPLAY && secChild.content) {
                entries.push({ key: `${prefix}.sc${sci}`, text: secChild.content });
            }
        }
        const accessory = comp.accessory;
        if (accessory && accessory.type === TYPES.THUMBNAIL) {
            const desc = prop(accessory, 'description');
            if (desc) entries.push({ key: `${prefix}.ac`, text: desc });
        }
        if (accessory && accessory.type === TYPES.BUTTON) {
            const label = prop(accessory, 'label');
            if (label) entries.push({ key: `${prefix}.ac`, text: label });
        }
    }

    function collectButton(comp, prefix) {
        const label = prop(comp, 'label');
        if (label) entries.push({ key: prefix, text: label });
    }

    function collectSelect(comp, prefix) {
        const options = comp.options || [];
        for (let oi = 0; oi < options.length; oi++) {
            const opt = options[oi];
            if (opt.label) entries.push({ key: `${prefix}.o${oi}`, text: opt.label });
            if (opt.description) entries.push({ key: `${prefix}.o${oi}.d`, text: opt.description });
        }
    }

    function collectActionRow(comp, prefix) {
        const children = comp.components || [];
        for (let ai = 0; ai < children.length; ai++) {
            const child = children[ai];
            if (child.type === TYPES.BUTTON) {
                collectButton(child, `${prefix}.b${ai}`);
            } else if (child.type === TYPES.STRING_SELECT) {
                collectSelect(child, `${prefix}.sel${ai}`);
            }
        }
    }

    function collectContainerChildren(children, prefix) {
        for (let chi = 0; chi < children.length; chi++) {
            const child = children[chi];
            const cp = `${prefix}.ch${chi}`;

            if (child.type === TYPES.TEXT_DISPLAY && child.content) {
                entries.push({ key: cp, text: child.content });
            } else if (child.type === TYPES.SECTION) {
                collectSectionText(child, cp);
            } else if (child.type === TYPES.MEDIA_GALLERY) {
                const items = child.items || [];
                for (let mi = 0; mi < items.length; mi++) {
                    const desc = prop(items[mi], 'description');
                    if (desc) entries.push({ key: `${cp}.mg${mi}`, text: desc });
                }
            } else if (child.type === TYPES.ACTION_ROW) {
                collectActionRow(child, cp);
            } else if (child.type === TYPES.STRING_SELECT) {
                collectSelect(child, cp);
            }
        }
    }

    for (let ci = 0; ci < components.length; ci++) {
        const comp = components[ci];
        const prefix = `${ci}`;

        if (comp.type === TYPES.CONTAINER) {
            const children = comp.components || [];
            collectContainerChildren(children, prefix);
        } else if (comp.type === TYPES.TEXT_DISPLAY && comp.content) {
            entries.push({ key: `${prefix}.td`, text: comp.content });
        } else if (comp.type === TYPES.SECTION) {
            collectSectionText(comp, prefix);
        } else if (comp.type === TYPES.MEDIA_GALLERY) {
            const items = comp.items || [];
            for (let mi = 0; mi < items.length; mi++) {
                const desc = prop(items[mi], 'description');
                if (desc) entries.push({ key: `${prefix}.mg${mi}`, text: desc });
            }
        } else if (comp.type === TYPES.ACTION_ROW) {
            collectActionRow(comp, prefix);
        }
    }

    return entries;
}

function detectSourceLanguage(messageContent, componentTextEntries, embeds) {
    const allText = [];
    if (messageContent) allText.push(messageContent);
    for (const entry of componentTextEntries) {
        allText.push(entry.text);
    }
    if (embeds && embeds.length > 0) {
        for (const embed of embeds) {
            if (embed.title) allText.push(embed.title);
            if (embed.description) allText.push(embed.description);
            if (embed.author?.name) allText.push(embed.author.name);
            if (embed.footer?.text) allText.push(embed.footer.text);
            if (embed.fields) {
                for (const field of embed.fields) {
                    if (field.name) allText.push(field.name);
                    if (field.value) allText.push(field.value);
                }
            }
        }
    }
    if (allText.length === 0) return 'auto';
    return detectLanguage(allText.join('\n'));
}

async function translateComponentsFromEntries(entries, sourceLang, targetLang) {
    const results = new Map();
    if (!entries || entries.length === 0) return results;

    const batchEntries = entries.map(e => ({ path: e.key, text: e.text }));
    const translated = await batchTranslateEntries(batchEntries, sourceLang, targetLang);

    for (const [key, text] of translated) {
        results.set(key, text);
    }

    return results;
}

function setContainerAccent(builder, comp) {
    const color = prop(comp, 'accentColor', 'accent_color');
    if (color) {
        try { builder.setAccentColor(color); } catch (_) { /* */ }
    }
}

function buildSeparator(comp) {
    const spacing = prop(comp, 'spacing');
    const divider = prop(comp, 'divider');
    return new SeparatorBuilder()
        .setSpacing(spacing === 1 ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large)
        .setDivider(divider !== false);
}

function rebuildSection(comp, prefix, translations) {
    const builder = new SectionBuilder();

    const secChildren = comp.components || [];
    const textDisplays = [];
    for (let sci = 0; sci < secChildren.length; sci++) {
        const secChild = secChildren[sci];
        if (secChild.type === TYPES.TEXT_DISPLAY && secChild.content) {
            const key = `${prefix}.sc${sci}`;
            const text = translations.get(key) || secChild.content;
            textDisplays.push(new TextDisplayBuilder().setContent(text));
        }
    }
    if (textDisplays.length > 0) {
        builder.addTextDisplayComponents(...textDisplays);
    }


    const accessory = comp.accessory;
    if (accessory) {
        if (accessory.type === TYPES.THUMBNAIL) {
            const thumbBuilder = new ThumbnailBuilder();
            const media = accessory.media || accessory;
            const url = prop(media, 'url');
            if (url) thumbBuilder.setURL(url);
            const descKey = `${prefix}.ac`;
            const desc = translations.get(descKey) || prop(accessory, 'description');
            if (desc) thumbBuilder.setDescription(desc);
            const spoiler = prop(accessory, 'spoiler');
            if (spoiler) thumbBuilder.setSpoiler(true);
            builder.setThumbnailAccessory(thumbBuilder);
        } else if (accessory.type === TYPES.BUTTON) {
            const btn = rebuildButton(accessory, `${prefix}.ac`, translations);
            if (btn) builder.setButtonAccessory(btn);
        }
    }

    return builder;
}

function rebuildButton(comp, prefix, translations) {
    try {
        const builder = new ButtonBuilder();
        const label = translations.get(prefix) || prop(comp, 'label');
        if (label) builder.setLabel(label);
        const style = prop(comp, 'style') || BTN_STYLE.SECONDARY;
        builder.setStyle(style);
        const customId = prop(comp, 'customId', 'custom_id');
        if (customId && style !== BTN_STYLE.LINK) builder.setCustomId(customId);
        const url = prop(comp, 'url');
        if (url && style === BTN_STYLE.LINK) builder.setURL(url);
        if (style !== BTN_STYLE.LINK) {
            builder.setDisabled(true);
        }
        const emoji = prop(comp, 'emoji');
        if (emoji) {
            if (typeof emoji === 'string') builder.setEmoji(emoji);
            else if (emoji.id) builder.setEmoji({ id: emoji.id, name: emoji.name, animated: emoji.animated });
            else if (emoji.name) builder.setEmoji(emoji.name);
        }
        return builder;
    } catch (_) {
        return null;
    }
}

function rebuildStringSelect(comp, prefix, translations) {
    try {
        const builder = new StringSelectMenuBuilder();
        const customId = prop(comp, 'customId', 'custom_id');
        if (customId) builder.setCustomId(customId);
        const placeholder = prop(comp, 'placeholder');
        if (placeholder) builder.setPlaceholder(placeholder);
        builder.setDisabled(true);
        const minValues = prop(comp, 'minValues', 'min_values');
        if (minValues != null) builder.setMinValues(minValues);
        const maxValues = prop(comp, 'maxValues', 'max_values');
        if (maxValues != null) builder.setMaxValues(maxValues);

        const options = comp.options || [];
        for (let oi = 0; oi < options.length; oi++) {
            const opt = options[oi];
            const optBuilder = new StringSelectMenuOptionBuilder();
            const label = translations.get(`${prefix}.o${oi}`) || opt.label;
            if (label) optBuilder.setLabel(String(label).slice(0, 100));
            const value = prop(opt, 'value');
            if (value) optBuilder.setValue(value);
            const desc = translations.get(`${prefix}.o${oi}.d`) || prop(opt, 'description');
            if (desc) optBuilder.setDescription(String(desc).slice(0, 100));
            const emoji = prop(opt, 'emoji');
            if (emoji) {
                if (typeof emoji === 'string') optBuilder.setEmoji(emoji);
                else if (emoji.id) optBuilder.setEmoji({ id: emoji.id, name: emoji.name, animated: emoji.animated });
                else if (emoji.name) optBuilder.setEmoji(emoji.name);
            }
            const isDefault = prop(opt, 'default');
            if (isDefault) optBuilder.setDefault(true);
            builder.addOptions(optBuilder);
        }

        return builder;
    } catch (_) {
        return null;
    }
}

function rebuildActionRow(comp, prefix, translations) {
    try {
        const builder = new ActionRowBuilder();
        const children = comp.components || [];
        for (let ai = 0; ai < children.length; ai++) {
            const child = children[ai];
            if (child.type === TYPES.BUTTON) {
                const btn = rebuildButton(child, `${prefix}.b${ai}`, translations);
                if (btn) builder.addComponents(btn);
            } else if (child.type === TYPES.STRING_SELECT) {
                const sel = rebuildStringSelect(child, `${prefix}.sel${ai}`, translations);
                if (sel) builder.addComponents(sel);
            }
            //
        }
        return builder.components.length > 0 ? builder : null;
    } catch (_) {
        return null;
    }
}


function rebuildMediaGallery(comp, prefix, translations) {
    try {
        const builder = new MediaGalleryBuilder();
        const items = comp.items || [];
        for (let mi = 0; mi < items.length; mi++) {
            const item = items[mi];
            const itemBuilder = new MediaGalleryItemBuilder();
            const media = prop(item, 'media');
            const url = prop(media, 'url') || prop(item, 'url');
            if (url) itemBuilder.setURL(url);
            const descKey = `${prefix}.mg${mi}`;
            const desc = translations.get(descKey) || prop(item, 'description');
            if (desc) itemBuilder.setDescription(desc);
            const spoiler = prop(item, 'spoiler');
            if (spoiler) itemBuilder.setSpoiler(true);
            builder.addItems(itemBuilder);
        }
        return builder;
    } catch (_) {
        return null;
    }
}

function rebuildContainer(comp, prefix, translations) {
    try {
        const builder = new ContainerBuilder();
        setContainerAccent(builder, comp);

        const children = comp.components || [];
        for (let chi = 0; chi < children.length; chi++) {
            const child = children[chi];
            const cp = `${prefix}.ch${chi}`;

            if (child.type === TYPES.TEXT_DISPLAY && child.content) {
                const text = translations.get(cp) || child.content;
                builder.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
            } else if (child.type === TYPES.SECTION) {
                const section = rebuildSection(child, cp, translations);
                builder.addSectionComponents(section);
            } else if (child.type === TYPES.SEPARATOR) {
                builder.addSeparatorComponents(buildSeparator(child));
            } else if (child.type === TYPES.MEDIA_GALLERY) {
                const mg = rebuildMediaGallery(child, cp, translations);
                if (mg) builder.addMediaGalleryComponents(mg);
            } else if (child.type === TYPES.ACTION_ROW) {
                const row = rebuildActionRow(child, cp, translations);
                if (row) builder.addActionRowComponents(row);
            } else if (child.type === TYPES.FILE) {
                try {
                    const fileBuilder = new FileBuilder();
                    const media = prop(child, 'file') || prop(child, 'media');
                    const url = prop(media, 'url') || prop(child, 'url');
                    if (url) fileBuilder.setURL(url);
                    const name = prop(child, 'name');
                    if (name) fileBuilder.setName(name);
                    const spoiler = prop(child, 'spoiler');
                    if (spoiler) fileBuilder.setSpoiler(true);
                    builder.addFileComponents(fileBuilder);
                } catch (_) { /* */ }
            } else if (child.type === TYPES.STRING_SELECT) {
                const sel = rebuildStringSelect(child, cp, translations);
                if (sel) {
                    const row = new ActionRowBuilder().addComponents(sel);
                    builder.addActionRowComponents(row);
                }
            }
        }

        return builder;
    } catch (_) {
        return null;
    }
}

function footerText(text) {
    return `-# ${text}`;
}


function buildLoadingState(useTraditionalFlow, t, targetLang, detectedSource = null) {
    const transition = detectedSource
        ? `Waterfall \u2022 ${getLanguageName(detectedSource)} - ${getLanguageName(targetLang)}`
        : `Waterfall \u2022 Auto - ${getLanguageName(targetLang)}`;
    const header = `# ${e.language} ${t('commands:translate.translating')}\n-# ${e.loading} ${t('common:loading')}`;

    if (useTraditionalFlow) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(COLORS.LOADING)
                .setThumbnail(TRANSLATE_ICON_URL)
                .setDescription(`${header}\n\n${footerText(transition)}`)],
        };
    }
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.LOADING)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(TRANSLATE_ICON_URL))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(transition)));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildEmptyState(useTraditionalFlow, extraTexts, targetLang) {
    const title = `${e.info} Nothing to Translate`;
    const transition = `Waterfall \u2022 Auto - ${getLanguageName(targetLang)}`;
    const bodyTexts = ['This message has no translatable text content.', ...extraTexts];

    if (useTraditionalFlow) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(COLORS.WARNING)
                .setTitle(title)
                .setDescription(bodyTexts.join('\n'))
                .setThumbnail(TRANSLATE_ICON_URL)
                .setFooter({ text: transition })],
            components: [],
        };
    }
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(TRANSLATE_ICON_URL))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${title}`),
                    ...bodyTexts.map(txt => new TextDisplayBuilder().setContent(txt))
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(transition)));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildErrorState(useTraditionalFlow, t, locale) {
    const targetLang = discordLocaleToLang(locale);
    const title = `${e.pixel_cross} ${t('common:error_occurred')}`;
    const transition = `Waterfall \u2022 Auto - ${getLanguageName(targetLang)}`;

    if (useTraditionalFlow) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(COLORS.ERROR)
                .setTitle(title)
                .setDescription(t('commands:translate.error_generic'))
                .setThumbnail(TRANSLATE_ICON_URL)
                .setFooter({ text: transition })],
            components: [],
        };
    }
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(TRANSLATE_ICON_URL))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## ${title}`),
                    new TextDisplayBuilder().setContent(t('commands:translate.error_generic'))
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(transition)));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildExpiredState(useTraditionalFlow, detectedSource) {
    const title = `${e.info} Selection Expired`;
    const body = 'No language was selected within 60 seconds.';
    const transition = `Waterfall \u2022 ${getLanguageName(detectedSource)}`;

    if (useTraditionalFlow) {
        return {
            embeds: [new EmbedBuilder()
                .setColor(COLORS.NEUTRAL)
                .setTitle(title)
                .setDescription(body)
                .setFooter({ text: transition })],
            components: [],
        };
    }
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.NEUTRAL)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}`),
            new TextDisplayBuilder().setContent(body)
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(transition)));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildPickState(useTraditionalFlow, selectMenu, detectedSource) {
    const title = `${e.info} Same Language Detected`;
    const body = `This message appears to already be in **${getLanguageName(detectedSource)}**.\nSelect a language to translate it into:`;
    const transition = `Waterfall \u2022 ${getLanguageName(detectedSource)}`;

    if (useTraditionalFlow) {
        return {
            content: '',
            embeds: [new EmbedBuilder()
                .setColor(COLORS.WARNING)
                .setTitle(title)
                .setDescription(body)
                .setFooter({ text: transition })],
            components: [new ActionRowBuilder().addComponents(selectMenu)],
        };
    }
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${title}`),
            new TextDisplayBuilder().setContent(body)
        )
        .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu))
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText(transition)));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildLanguageSelectMenu(detectedSource, customId) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder('Select a language to translate to...')
        .setMinValues(1)
        .setMaxValues(1);

    const filteredLangs = LANGUAGES.filter(l => l.value !== detectedSource).slice(0, 25);
    for (const lang of filteredLangs) {
        const opt = new StringSelectMenuOptionBuilder()
            .setLabel(lang.name)
            .setValue(lang.value);
        const flag = LANG_FLAGS[lang.value];
        if (flag) opt.setEmoji(flag);
        selectMenu.addOptions(opt);
    }
    return selectMenu;
}

function embedToPlainObject(embedData) {
    return {
        title: embedData.title || undefined,
        description: embedData.description || undefined,
        color: embedData.color || undefined,
        url: embedData.url || undefined,
        timestamp: embedData.timestamp || undefined,
        thumbnail: embedData.thumbnail ? { url: getMediaUrl(embedData.thumbnail) } : undefined,
        image: embedData.image ? { url: getMediaUrl(embedData.image) } : undefined,
        video: embedData.video ? { url: getMediaUrl(embedData.video) } : undefined,
        author: embedData.author ? {
            name: embedData.author.name,
            url: embedData.author.url || undefined,
            icon_url: prop(embedData.author, 'icon_url', 'iconURL'),
        } : undefined,
        footer: embedData.footer ? {
            text: embedData.footer.text,
            icon_url: prop(embedData.footer, 'icon_url', 'iconURL'),
        } : undefined,
        fields: embedData.fields && embedData.fields.length > 0 ? embedData.fields.map(f => ({
            name: f.name || '\u200B',
            value: f.value || '\u200B',
            inline: f.inline ?? false,
        })) : undefined,
    };
}

function rebuildActionRows(components, translations) {
    const rows = [];
    for (const comp of components) {
        if (comp.type === TYPES.ACTION_ROW) {
            const row = rebuildActionRow(comp, '0', translations);
            if (row) rows.push(row);
        }
    }
    return rows;
}
//
module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName("Translate Message")
        .setNameLocalizations(commandMeta.translateMessage?.name || { 'en-US': 'Translate Message' })
        .setType(ApplicationCommandType.Message),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: true,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        let useTraditionalFlow = false;
        let targetLang = discordLocaleToLang(interaction.locale);
        let detectedSource = 'auto';

        try {
            const message = interaction.targetMessage;

            let messageContent = message.content || '';
            let embeds = message.embeds || [];
            let components = message.components || [];
            let isForwarded = false;
            let forwardedReason = '';

            if (message.messageSnapshots && message.messageSnapshots.size > 0) {
                isForwarded = true;
                const snapshot = message.messageSnapshots.first();
                if (snapshot && snapshot.message) {
                    const snap = snapshot.message;
                    if (!messageContent && snap.content) messageContent = snap.content;
                    if (embeds.length === 0 && snap.embeds) embeds = snap.embeds;
                    if (components.length === 0 && snap.components) components = snap.components;
                    if (settings?.debug == 'true') logger.debug(`[Translate] Forwarded message detected, snapshot content: ${messageContent.length}, embeds: ${embeds.length}, components: ${components.length}`);

                    const hasAnyContent = messageContent.trim().length > 0 || embeds.length > 0 || components.length > 0;
                    if (!hasAnyContent && snap.channelId && snap.id) {
                        try {
                            const channel = bot.channels.cache.get(snap.channelId);
                            if (!channel) {
                                forwardedReason = 'The bot does not have access to the original channel where this message was sent.';
                            } else {
                                const originalMessage = await channel.messages.fetch(snap.id);
                                if (originalMessage) {
                                    if (!messageContent && originalMessage.content) messageContent = originalMessage.content;
                                    if (embeds.length === 0 && originalMessage.embeds.length > 0) embeds = originalMessage.embeds;
                                    if (components.length === 0 && originalMessage.components.length > 0) components = originalMessage.components;
                                    if (settings?.debug == 'true') logger.debug(`[Translate] Fetched original forwarded message, components: ${components.length}`);
                                }
                            }
                        } catch (ex) {
                            if (settings?.debug == 'true') logger.debug(`[Translate] Could not fetch original forwarded message: ${ex.message}`);
                            forwardedReason = `Could not retrieve the original message: ${ex.message}`;
                        }
                    }
                }
            }

            const hasContent = messageContent.trim().length > 0;
            const hasEmbeds = embeds.length > 0;
            const hasComponents = components.length > 0;

            let componentTextEntries = hasComponents ? collectComponentText(components) : [];
            const hasTranslatableContent = hasContent || hasEmbeds || componentTextEntries.length > 0;

            if (settings?.debug == 'true') logger.debug(`[Translate] components: ${components.length}, content: ${messageContent.length}, embeds: ${embeds.length}, componentTextEntries: ${componentTextEntries.length}`);

            const isV2Message = components.some(c => c.type === TYPES.CONTAINER || c.type === TYPES.TEXT_DISPLAY || c.type === TYPES.SECTION);
            useTraditionalFlow = hasEmbeds && !isV2Message;


            await interaction.reply(buildLoadingState(useTraditionalFlow, t, targetLang));

            if (!hasTranslatableContent) {
                const extraTexts = [];
                if (isForwarded) {
                    if (forwardedReason) {
                        extraTexts.push(`-# ${forwardedReason}`);
                    } else {
                        extraTexts.push('-# This is a forwarded message and its content could not be retrieved. The bot may not have access to the original channel.');
                    }
                }
                return interaction.editReply(buildEmptyState(useTraditionalFlow, extraTexts, targetLang));
            }

            detectedSource = detectSourceLanguage(messageContent, componentTextEntries, embeds);


            if (detectedSource === targetLang) {
                const selectMenu = buildLanguageSelectMenu(detectedSource, `translate_lang_${interaction.id}`);
                const reply = await interaction.editReply(buildPickState(useTraditionalFlow, selectMenu, detectedSource));


                const selectedLang = await new Promise((resolve) => {
                    const collector = reply.createMessageComponentCollector({
                        componentType: ComponentType.StringSelect,
                        time: 60_000,
                    });

                    collector.on('collect', async (i) => {
                        if (i.user.id !== interaction.user.id) {
                            return i.reply({
                                content: `${e.pixel_cross} Only <@${interaction.user.id}> can use this menu.`,
                                flags: MessageFlags.Ephemeral,
                            });
                        }
                        collector.stop('selected');
                        await i.deferUpdate();
                        resolve(i.values[0]);
                    });

                    collector.on('end', (_, reason) => {
                        if (reason !== 'selected') resolve(null);
                    });
                });

                if (!selectedLang) {
                    return interaction.editReply(buildExpiredState(useTraditionalFlow, detectedSource));
                }

                targetLang = selectedLang;
                await interaction.editReply(buildLoadingState(useTraditionalFlow, t, targetLang, detectedSource));
            }

            let translatedContent = '';
            if (hasContent) {
                const { translated } = await translateText(messageContent, detectedSource, targetLang);
                translatedContent = translated;
            }

            let componentTranslations = new Map();
            if (componentTextEntries.length > 0) {
                componentTranslations = await translateComponentsFromEntries(componentTextEntries, detectedSource, targetLang);
                if (settings?.debug == 'true') logger.debug(`[Translate] CV2 translations: ${componentTranslations.size} entries translated`);
            }

            const translatedEmbeds = [];
            if (hasEmbeds) {
                for (const embedData of embeds) {
                    try {
                        const plainEmbed = embedToPlainObject(embedData);
                        const translatedEmbed = await processEmbed(plainEmbed, detectedSource, targetLang);
                        translatedEmbeds.push(translatedEmbed);
                    } catch (embedErr) {
                        logger.error(`[TranslateMessage] Embed translation error:`, embedErr.message || embedErr);
                        translatedEmbeds.push(rebuildEmbed(embedToPlainObject(embedData)));
                    }
                }
            }

            if (useTraditionalFlow) {
                let finalContent = translatedContent
                    ? `-# Waterfall \u2022 ${getLanguageName(detectedSource)} - ${getLanguageName(targetLang)}\n\n${translatedContent}`
                    : `-# Waterfall \u2022 ${getLanguageName(detectedSource)} - ${getLanguageName(targetLang)}`;

                const followUpActionRows = rebuildActionRows(components, componentTranslations);

                await interaction.editReply({
                    content: finalContent,
                    embeds: translatedEmbeds,
                    components: followUpActionRows
                });
                return;
            }

            const resultComponents = [];

            resultComponents.push(new TextDisplayBuilder().setContent(`-# Waterfall \u2022 ${getLanguageName(detectedSource)} - ${getLanguageName(targetLang)}`));
            resultComponents.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

            if (translatedContent) {
                resultComponents.push(new TextDisplayBuilder().setContent(translatedContent));
                resultComponents.push(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            }

            for (let ci = 0; ci < components.length; ci++) {
                const comp = components[ci];
                const prefix = `${ci}`;

                try {
                    if (comp.type === TYPES.CONTAINER) {
                        const container = rebuildContainer(comp, prefix, componentTranslations);
                        if (container) resultComponents.push(container);
                    } else if (comp.type === TYPES.TEXT_DISPLAY) {
                        const key = `${prefix}.td`;
                        const text = componentTranslations.get(key) || comp.content;
                        resultComponents.push(new TextDisplayBuilder().setContent(text));
                    } else if (comp.type === TYPES.SECTION) {
                        const section = rebuildSection(comp, prefix, componentTranslations);
                        resultComponents.push(section);
                    } else if (comp.type === TYPES.SEPARATOR) {
                        resultComponents.push(buildSeparator(comp));
                    } else if (comp.type === TYPES.MEDIA_GALLERY) {
                        const mg = rebuildMediaGallery(comp, prefix, componentTranslations);
                        if (mg) resultComponents.push(mg);
                    } else if (comp.type === TYPES.ACTION_ROW) {
                        if (!hasEmbeds) {
                            const row = rebuildActionRow(comp, prefix, componentTranslations);
                            if (row) resultComponents.push(row);
                        }
                    } else if (comp.type === TYPES.FILE) {
                        try {
                            const fileBuilder = new FileBuilder();
                            const media = prop(comp, 'file') || prop(comp, 'media');
                            const url = prop(media, 'url') || prop(comp, 'url');
                            if (url) fileBuilder.setURL(url);
                            const name = prop(comp, 'name');
                            if (name) fileBuilder.setName(name);
                            resultComponents.push(fileBuilder);
                        } catch (_) { /* */ }
                    }
                } catch (compErr) {
                    logger.error(`[TranslateMessage] Error rebuilding component ${ci} (type ${comp.type}):`, compErr.message || compErr);
                }
            }

            if (hasEmbeds) {
                await interaction.editReply({
                    components: resultComponents.length > 0 ? resultComponents : undefined,
                    flags: MessageFlags.IsComponentsV2,
                });

                if (translatedEmbeds.length > 0) {
                    const followUpActionRows = rebuildActionRows(components, componentTranslations);
                    await interaction.followUp({
                        embeds: translatedEmbeds,
                        components: followUpActionRows.length > 0 ? followUpActionRows : undefined,
                    });
                }
                return;
            }

            await interaction.editReply({
                components: resultComponents.length > 0 ? resultComponents : undefined,
                flags: MessageFlags.IsComponentsV2,
            });

        } catch (err) {
            logger.error(`[TranslateMessage] Error:`, err.message || err);

            await interaction.editReply(buildErrorState(useTraditionalFlow, t, interaction.locale));

            const isDev = settings?.devs?.includes(interaction.user.id);
            if (isDev) {
                const parts = [];
                if (err.message) parts.push(err.message);
                if (err.errors) parts.push(JSON.stringify(err.errors, null, 2).slice(0, 500));
                if (err.rawError?.errors) parts.push(JSON.stringify(err.rawError.errors, null, 2).slice(0, 500));
                if (err.rawError?.message && err.rawError.message !== err.message) parts.push(err.rawError.message);
                if (err.response?.data) parts.push(JSON.stringify(err.response.data).slice(0, 500));
                const errorInfo = parts.join('\n').replace(/```/g, '\u200B```').slice(0, 1900);
                await interaction.followUp({
                    content: '```\n' + errorInfo + '\n```',
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
    help: {
        name: "translateMessage",
        description: "Translate a message",
        category: "Utility",
        permissions: [],
        botPermissions: [],
        created: Date.now()
    }
};

// contributors: @relentiousdragon
