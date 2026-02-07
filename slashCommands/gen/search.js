require("dotenv").config();
const { MessageFlags, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ConnectionService } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');
const { GOOGLE_API_KEY, GOOGLE_CSE_ID, SERPAPI_KEY, OMDB_API_KEY } = process.env;
const { getJson } = require('serpapi');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const logger = require("../../logger.js");
const funcs = require("../../util/functions.js");
const ddg = require("../../util/duckduckgo.js");
const PAGINATION_CACHE = new Map();
const PAGINATION_TTL = 10 * 60 * 1000;

const DDG_AUTOCOMPLETE_CACHE = new Map();
const DDG_CACHE_TTL = 60 * 60 * 1000;
const DDG_CACHE_MAX_SIZE = 1000;
const DDG_RATE_LIMIT = new Map();
const DDG_COOLDOWN = 500;

function makeSessionId(engine, query, userId) {
    const short = crypto.randomBytes(6).toString('hex');
    return `${engine}_${short}_${userId}`;
}

function setPaginationCache(sessionId, results, meta, userId) {
    PAGINATION_CACHE.set(sessionId, { timestamp: Date.now(), results, meta, userId });
}

function getPaginationCache(sessionId) {
    const entry = PAGINATION_CACHE.get(sessionId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > PAGINATION_TTL) {
        PAGINATION_CACHE.delete(sessionId);
        return null;
    }
    return entry;
}

function cleanupPaginationCache() {
    const now = Date.now();
    for (const [key, entry] of PAGINATION_CACHE.entries()) {
        if (now - entry.timestamp > PAGINATION_TTL) {
            PAGINATION_CACHE.delete(key);
        }
    }
}
setInterval(cleanupPaginationCache, 60 * 1000);

function isPaginationExpired(sessionId) {
    const entry = PAGINATION_CACHE.get(sessionId);
    if (!entry) return true;
    return Date.now() - entry.timestamp > PAGINATION_TTL;
}

function parseDuckDuckGoResults(data, query) {
    let results = [];
    if (data.Abstract && data.AbstractURL) {
        results.push({
            title: data.Heading || query,
            description: data.Abstract,
            url: data.AbstractURL,
            infobox: data.Infobox || null,
            image: data.Image || null,
            ImageWidth: data.ImageWidth || null,
            ImageHeight: data.ImageHeight || null,
            isAbstract: true
        });
    }
    if (data.Results && data.Results.length > 0) {
        results = results.concat(
            data.Results.filter(r => r.Text && r.FirstURL).map(r => ({
                title: r.Text.split(" - ")[0],
                description: r.Text,
                url: r.FirstURL
            }))
        );
    }
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        data.RelatedTopics.forEach(item => {
            if (item.Text && item.FirstURL) {
                results.push({
                    title: item.Text.split(" - ")[0],
                    description: item.Text,
                    url: item.FirstURL,
                    isRelated: true
                });
            } else if (item.Topics && Array.isArray(item.Topics)) {
                item.Topics.forEach(subItem => {
                    if (subItem.Text && subItem.FirstURL) {
                        results.push({
                            title: subItem.Text.split(" - ")[0],
                            description: subItem.Text,
                            url: subItem.FirstURL,
                            isRelated: true
                        });
                    }
                });
            }
        });
    }
    return results;
}

function cleanInfoboxFields(fields) {
    const allowed = [
        'Born', 'Age', 'Other names', 'Education', 'Alma mater', 'Occupation', 'Years active', 'Partner(s)',
        'Twitter profile', 'Instagram profile', 'Facebook profile', 'IMDb ID', 'Wikidata description', 'Known for', 'Awards', 'Net worth'
    ];
    const socialMap = {
        'Twitter profile': v => `[Twitter](https://x.com/${v})`,
        'Instagram profile': v => `[Instagram](https://instagram.com/${v})`,
        'Facebook profile': v => `[Facebook](https://facebook.com/${v})`,
        'IMDb ID': v => {
            if (/^nm\d{7,8}$/.test(v)) return `[IMDb](https://www.imdb.com/name/${v}/)`;
            if (/^tt\d{7,8}$/.test(v)) return `[IMDb](https://www.imdb.com/title/${v}/)`;
            return `[IMDb](https://www.imdb.com/${v}/)`;
        }
    };
    return fields
        .filter(f => allowed.includes(f.label) && f.value && typeof f.value === 'string' && !f.value.startsWith('[object'))
        .map(f => {
            if (socialMap[f.label]) {
                return { name: f.label, value: socialMap[f.label](f.value), inline: true };
            }
            return { name: f.label, value: String(f.value).slice(0, 1024), inline: true };
        });
}
// STASHED
function isValidImdbId(id) {
    return /^tt\d{7,8}$/.test(id) || /^nm\d{7,8}$/.test(id);
}

async function fetchImdbRating(imdbId) {
    if (!OMDB_API_KEY) return null;
    try {
        const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`;
        const res = await axios.get(url);
        if (res.data && res.data.Response === 'True' && res.data.Title) {
            return {
                rating: res.data.imdbRating && res.data.imdbRating !== 'N/A' ? res.data.imdbRating + '/10' : null,
                title: res.data.Title,
                type: res.data.Type,
                year: res.data.Year,
                genre: res.data.Genre,
                writer: res.data.Writer,
                rated: res.data.Rated,
                language: res.data.Language,
                totalSeasons: res.data.totalSeasons,
                metascore: res.data.Metascore,
                imdbVotes: res.data.imdbVotes,
                ratings: res.data.Ratings
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function buildDuckDuckGoComponent(result, page, totalPages, bot, query, sessionId, t, specialBuilder = null) {
    let domain, logoUrl;
    try {
        domain = new URL(result.url).hostname;
        logoUrl = await funcs.getLogoUrl(domain);
    } catch {
        domain = 'duckduckgo.com';
    }

    if (domain === "duckduckgo.com" || !domain) {
        logoUrl = 'https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/duckduckgo-icon.png';
    }

    function getShortTitle(title) {
        if (!title) return '';
        let t = title.split(' - ')[0].split(':')[0];
        if (t.length > 80) t = t.slice(0, 80) + '...';
        return t.trim();
    }

    if (result.isRelated && !result.isAbstract) {
        const ddgPrevId = `search_ddg_prev_${page - 1}_${sessionId}`;
        const ddgNextId = `search_ddg_next_${page + 1}_${sessionId}`;
        const expired = isPaginationExpired(sessionId);

        const textDisplays = [
            new TextDisplayBuilder().setContent(`# ${t('commands:search.related_topics')}`),
            result.title ? new TextDisplayBuilder().setContent(result.title) : undefined
        ].filter(Boolean);
        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl))
            .addTextDisplayComponents(...textDisplays);
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.prev'))
                .setCustomId(ddgPrevId)
                .setDisabled(page === 1 || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.next'))
                .setCustomId(ddgNextId)
                .setDisabled(page === totalPages || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(t('common:visit'))
                .setURL(result.url || 'https://duckduckgo.com')
        );
        const container = new ContainerBuilder()
            .setAccentColor(0x4756ff);
        if (specialBuilder && page === 1) specialBuilder(container);
        container
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: page, total: totalPages })}`)
            )
            .addActionRowComponents(actionRow);
        return container;
    }

    if (result.isAbstract) {
        const ddgPrevId = `search_ddg_prev_${page - 1}_${sessionId}`;
        const ddgNextId = `search_ddg_next_${page + 1}_${sessionId}`;
        const expired = isPaginationExpired(sessionId);

        let width = result.ImageWidth, height = result.ImageHeight;
        let useThumbnail = false;
        if (result.image && result.image !== "") {
            if (typeof width !== 'number' || typeof height !== 'number') {
                width = null; height = null;
            }
            if (width && height && width <= height) {
                useThumbnail = true;
            } else if (width && height && width > height && width / height > 1.1) {
                useThumbnail = false;
            } else if (width && height && width === height) {
                useThumbnail = true;
            }
        }
        let markdown2 = `# ${result.title || query}\n`;
        if (result.url) markdown2 += `-# 🔗 [${domain}](${result.url})\n`;
        let markdown = '';
        let imdbId = null;
        let imdbRating = null;
        let imdbType = null;
        if (result.infobox) {
            const infoboxContent = result.infobox.content || [];
            const embedFields = cleanInfoboxFields(infoboxContent);
            let wikidataDesc = null;
            for (const f of embedFields) {
                if (f.name === 'Wikidata description') {
                    wikidataDesc = f.value;
                    continue;
                }
                if (f.name === 'IMDb ID') {
                    let rawImdbId = f.value;
                    const match = /imdb\.com\/(title|name)\/(tt\d{7,8}|nm\d{7,8})/i.exec(f.value);
                    if (match) rawImdbId = match[2];
                    imdbId = rawImdbId;
                    imdbType = (infoboxContent.find(x => x.label === 'Occupation') || {}).value || '';
                    const imdbData = await fetchImdbRating(imdbId);
                    if (imdbData && imdbData.title) {
                        let imdbLink = /^tt\d{7,8}$/.test(imdbId)
                            ? `https://www.imdb.com/title/${imdbId}/`
                            : /^nm\d{7,8}$/.test(imdbId)
                                ? `https://www.imdb.com/name/${imdbId}/`
                                : `https://www.imdb.com/${imdbId}/`;
                        let imdbLine = `**IMDb:** [IMDb](${imdbLink})`;
                        if (imdbData.rating) imdbLine += ` (${imdbData.rating})`;
                        markdown += imdbLine + '\n';
                        if (["movie", "series", "episode"].includes(imdbData.type)) {
                            const fields = [
                                imdbData.year ? `**Year:** ${imdbData.year}` : null,
                                imdbData.genre ? `**Genre:** ${imdbData.genre}` : null,
                                imdbData.writer ? `**Writer:** ${imdbData.writer}` : null,
                                imdbData.rated ? `**Rated:** ${imdbData.rated}` : null,
                                imdbData.language ? `**Language:** ${imdbData.language}` : null,
                                imdbData.totalSeasons ? `**Total Seasons:** ${imdbData.totalSeasons}` : null,
                                imdbData.metascore && imdbData.metascore !== 'N/A' ? `**Metascore:** ${imdbData.metascore}` : null,
                                imdbData.imdbVotes ? `**IMDb Votes:** ${imdbData.imdbVotes}` : null
                            ].filter(Boolean);
                            const bigFields = [];
                            const smallFields = [];
                            fields.forEach(f => {
                                if (f.startsWith('**Writer:**') || f.startsWith('**Genre:**') || f.startsWith('**Language:**')) {
                                    bigFields.push(f);
                                } else {
                                    smallFields.push(f);
                                }
                            });
                            for (let i = 0; i < bigFields.length; i += 2) {
                                markdown += bigFields.slice(i, i + 2).join(' | ') + '\n';
                            }
                            for (let i = 0; i < smallFields.length; i += 3) {
                                markdown += smallFields.slice(i, i + 3).join(' | ') + '\n';
                            }
                            if (imdbData.ratings && Array.isArray(imdbData.ratings)) {
                                imdbData.ratings.forEach(r => {
                                    if (r.Source && r.Value) markdown += `**${r.Source}:** ${r.Value}\n`;
                                });
                            }
                        }
                    }
                    continue;
                }
                markdown += `**${f.name}:** ${f.value}\n`;
            }
            if (wikidataDesc) {
                markdown += `\n-# ${wikidataDesc}\n`;
            }
        }
        if (result.description) markdown += `\n${result.description.slice(0, 2000)}\n`;

        let faviconDomain = result.OfficialDomain || null;
        if (!faviconDomain && result.infobox && Array.isArray(result.infobox.content)) {
            const officialWebsiteField = result.infobox.content.find(f => f.label === 'Official Website' && typeof f.value === 'string');
            if (officialWebsiteField) {
                try {
                    faviconDomain = new URL(officialWebsiteField.value).hostname;
                } catch { }
            }
        }
        let faviconUrl = null;
        let validFavicon = false;
        if (faviconDomain) {
            try {
                faviconUrl = await funcs.getLogoUrl(faviconDomain);
                validFavicon = await funcs.isImageUrl(faviconUrl);
            } catch { }
        }
        const wikiLogo = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/100px-Wikipedia-logo-v2.svg.png';
        const thumbnailUrl = validFavicon ? faviconUrl : wikiLogo;

        const section = new SectionBuilder()
            .setThumbnailAccessory(
                useThumbnail && result.image
                    ? new ThumbnailBuilder().setURL(result.image.startsWith('http') ? result.image : `https://duckduckgo.com${result.image}`)
                    : new ThumbnailBuilder().setURL(thumbnailUrl)
            )
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(markdown2));
        let mediaGallery = null;
        if (!useThumbnail && result.image && result.image !== "") {
            let width = result.ImageWidth, height = result.ImageHeight;
            if (typeof width !== 'number' || typeof height !== 'number') {
                width = null; height = null;
            }
            if (width && height && width > height && width / height > 1.1) {
                const imageUrl = result.image.startsWith('http') ? result.image : `https://duckduckgo.com${result.image}`;
                mediaGallery = new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(imageUrl)
                );
            }
        }
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.prev'))
                .setCustomId(ddgPrevId)
                .setDisabled(page === 1 || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.next'))
                .setCustomId(ddgNextId)
                .setDisabled(page === totalPages || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(`${result.url ? t('common:read_more') : t('common:visit')}`)
                .setURL(result.url || 'https://duckduckgo.com')
        );
        const container = new ContainerBuilder()
            .setAccentColor(0x4756ff);
        if (specialBuilder && page === 1) specialBuilder(container);
        container
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(markdown));
        if (mediaGallery) container.addMediaGalleryComponents(mediaGallery);
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: page, total: totalPages })}`)
        );
        container.addActionRowComponents(actionRow);
        return container;
    }

    if (!result.isAbstract && !result.infobox) {
        const ddgPrevId = `search_ddg_prev_${page - 1}_${sessionId}`;
        const ddgNextId = `search_ddg_next_${page + 1}_${sessionId}`;
        const expired = isPaginationExpired(sessionId);

        let shortTitle = getShortTitle(result.title);
        let content = '';
        content = result.description || result.title;
        if (shortTitle == result.title) {
            shortTitle = `${query}`;
        }
        const textDisplays = [
            new TextDisplayBuilder().setContent(`# ${shortTitle}`),
            content ? new TextDisplayBuilder().setContent(content) : undefined
        ].filter(Boolean);
        const section = new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl))
            .addTextDisplayComponents(...textDisplays);
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.prev'))
                .setCustomId(ddgPrevId)
                .setDisabled(page === 1 || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Secondary)
                .setLabel(t('common:pagination.next'))
                .setCustomId(ddgNextId)
                .setDisabled(page === totalPages || expired),
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(t('common:visit'))
                .setURL(result.url || 'https://duckduckgo.com')
        );
        const container = new ContainerBuilder()
            .setAccentColor(0x4756ff);
        if (specialBuilder && page === 1) specialBuilder(container);
        container
            .addSectionComponents(section)
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: page, total: totalPages })}`)
            )
            .addActionRowComponents(actionRow);
        return container;
    }
}

async function buildSerpApiComponent(res, page, totalPages, engineName, color, emoji, query, logoUrl, domain, profanityDetected, sessionId, t, specialBuilder = null) {
    const serpPrevId = `search_${engineName}_prev_${page - 1}_${sessionId}`;
    const serpNextId = `search_${engineName}_next_${page + 1}_${sessionId}`;
    const expired = isPaginationExpired(sessionId);

    const engineLogos = {
        google: 'https://www.google.com/s2/favicons?domain=google.com&sz=256',
        bing: 'https://www.google.com/s2/favicons?domain=bing.com&sz=256',
        yahoo: 'https://www.google.com/s2/favicons?domain=yahoo.com&sz=256',
        yandex: 'https://www.google.com/s2/favicons?domain=yandex.com&sz=256'
    };

    const defaultLogo = engineLogos[engineName] || logoUrl;

    let thumbnailUrl = defaultLogo;
    let mediaGallery = null;
    let dateTimestamp = null;
    const contentLines = [];
    const extraButtons = [];
    let replaceSnippetWithWiki = null;

    let dateString = null;
    if (res.date) {
        try {
            const date = new Date(res.date);
            if (!isNaN(date.getTime())) {
                dateTimestamp = Math.floor(date.getTime() / 1000);
                dateString = `-# **${t('commands:search.meta.date')}:** <t:${dateTimestamp}:R>`;
            }
        } catch (err) {
            console.log("Error parsing date:", err);
        }
    } else {
        const dateMatch = res.snippet?.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\s*\.{3}/);
        if (dateMatch) {
            try {
                const date = new Date(dateMatch[1]);
                if (!isNaN(date.getTime())) {
                    dateTimestamp = Math.floor(date.getTime() / 1000);
                    dateString = `-# **${t('commands:search.meta.date')}:** <t:${dateTimestamp}:R>`;
                }
            } catch (err) {
                console.log("Error parsing date from snippet:", err);
            }
        }
    }

    let allImages = [];
    let validImages = [];

    if (engineName === 'google' && res.pagemap) {
        if (res.pagemap.cse_image && Array.isArray(res.pagemap.cse_image) && res.pagemap.cse_image[0]?.src) {
            allImages.push({ url: res.pagemap.cse_image[0].src, width: null, height: null, source: 'cse_image' });
        }
        if (res.pagemap.cse_thumbnail && Array.isArray(res.pagemap.cse_thumbnail) && res.pagemap.cse_thumbnail[0]?.src) {
            allImages.push({ url: res.pagemap.cse_thumbnail[0].src, width: null, height: null, source: 'cse_thumbnail' });
        }
        if (res.pagemap.imageobject && Array.isArray(res.pagemap.imageobject)) {
            allImages.push(...res.pagemap.imageobject.map(img => ({
                url: img.url,
                width: img.width ? parseInt(img.width) : null,
                height: img.height ? parseInt(img.height) : null,
                source: 'imageobject'
            })));
        }
        if (res.pagemap.metatags && Array.isArray(res.pagemap.metatags) && res.pagemap.metatags[0]) {
            const metatags = res.pagemap.metatags[0];
            if (metatags['og:image']) {
                allImages.push({
                    url: metatags['og:image'],
                    width: metatags['og:image:width'] ? parseInt(metatags['og:image:width']) : null,
                    height: metatags['og:image:height'] ? parseInt(metatags['og:image:height']) : null,
                    source: 'og:image'
                });
            }
            if (metatags['twitter:image']) {
                allImages.push({
                    url: metatags['twitter:image'],
                    width: null,
                    height: null,
                    source: 'twitter:image'
                });
            }
        }
    } else if (engineName === 'bing') {
        if (res.thumbnail && !res.thumbnail.includes('w=32&h=32')) {
            allImages.push({ url: res.thumbnail, width: 100, height: 100, source: 'thumbnail', isSmall: res.thumbnail.includes('w=32&h=32') });
        }
        if (res.pagemap && res.pagemap.cse_image && Array.isArray(res.pagemap.cse_image) && res.pagemap.cse_image[0]?.src) {
            allImages.push({ url: res.pagemap.cse_image[0].src, width: null, height: null, source: 'cse_image', isSmall: false });
        }
        if (res.pagemap && res.pagemap.cse_thumbnail && Array.isArray(res.pagemap.cse_thumbnail) && res.pagemap.cse_thumbnail[0]?.src) {
            allImages.push({ url: res.pagemap.cse_thumbnail[0].src, width: null, height: null, source: 'cse_thumbnail', isSmall: false });
        }
        if (res.rich_snippet && res.rich_snippet.extensions) {
            res.rich_snippet.extensions.slice(0, 10).forEach(ext => {
                contentLines.push(`-# ${ext}`);
            });
        }
        if (res.sitelinks && res.sitelinks.inline && Array.isArray(res.sitelinks.inline)) {
            res.sitelinks.inline.slice(0, 3).forEach(link => {
                extraButtons.push({ url: link.link, type: link.title.slice(0, 10) + '...' });
            });
        }
    } else if (engineName === 'yahoo') {
        let hasValidSnippet = false;
        if (res.snippet && res.displayed_link) {
            const cleanSnippet = res.snippet.trim();
            const cleanDisplayedLink = res.displayed_link.trim();
            if (cleanSnippet === cleanDisplayedLink ||
                cleanSnippet.startsWith(cleanDisplayedLink) ||
                cleanDisplayedLink.includes(cleanSnippet)) {
                hasValidSnippet = false;
            } else {
                hasValidSnippet = true;
                contentLines.push(res.snippet);
            }
        }
        if (!hasValidSnippet && (!res.snippet || res.snippet === '')) {
            contentLines.push(`-# ${t('common:pagination.not_for_you')}`);
        }
        if (res.thumbnail) {
            allImages.push({ url: res.thumbnail, width: null, height: null, source: 'thumbnail', isSmall: false });
        }
        if (res.pagemap) {
            if (res.pagemap.cse_image && Array.isArray(res.pagemap.cse_image) && res.pagemap.cse_image[0]?.src) {
                allImages.push({ url: res.pagemap.cse_image[0].src, width: null, height: null, source: 'cse_image', isSmall: false });
            }
            if (res.pagemap.cse_thumbnail && Array.isArray(res.pagemap.cse_thumbnail) && res.pagemap.cse_thumbnail[0]?.src) {
                allImages.push({ url: res.pagemap.cse_thumbnail[0].src, width: null, height: null, source: 'cse_thumbnail', isSmall: false });
            }
            if (res.pagemap.metatags && Array.isArray(res.pagemap.metatags) && res.pagemap.metatags[0]) {
                const metatags = res.pagemap.metatags[0];
                if (metatags['og:image']) {
                    allImages.push({
                        url: metatags['og:image'],
                        width: metatags['og:image:width'] ? parseInt(metatags['og:image:width']) : null,
                        height: metatags['og:image:height'] ? parseInt(metatags['og:image:height']) : null,
                        source: 'og:image',
                        isSmall: false
                    });
                }
            }
        }
        if (res.sitelinks && res.sitelinks.expanded && Array.isArray(res.sitelinks.expanded)) {
            contentLines.push(`-# **${t('commands:search.related_topics')}:**`);
            res.sitelinks.expanded.slice(0, 3).forEach((link, index) => {
                const truncatedUrl = link.link.length > 512 ? link.link.substring(0, 509) + '...' : link.link;
                extraButtons.push({ url: truncatedUrl, type: `Link ${index + 1}`, originalUrl: link.link });
                contentLines.push(`-# [${link.title}](${truncatedUrl})`);
            });
        }
    }

    if (allImages.length > 0) {
        const imageChecks = await Promise.allSettled(
            allImages.map(async (img) => {
                if (img.url) {
                    try {
                        const isValid = await funcs.isImageUrl(img.url);
                        return { ...img, isValid };
                    } catch (err) {
                        return { ...img, isValid: false };
                    }
                }
                return { ...img, isValid: false };
            })
        );
        validImages = imageChecks
            .filter(result => result.status === 'fulfilled' && result.value.isValid)
            .map(result => result.value);
    }

    let mediaGalleryImage = null;
    let thumbnailImage = null;
    let domainLogoUrl = null;
    let validDomainLogo = false;
    let validDefaultLogo = false;

    try {
        domainLogoUrl = await funcs.getLogoUrl(domain);
        validDomainLogo = await funcs.isImageUrl(domainLogoUrl);
        if (!validDomainLogo) domainLogoUrl = null;
    } catch (err) {
        console.log("Failed to get domain logo:", err.message);
    }
    try {
        validDefaultLogo = await funcs.isImageUrl(defaultLogo);
    } catch (err) {
        console.log("Failed to check default logo:", err.message);
    }

    if (engineName === 'google') {
        for (const img of validImages) {
            if (img.isSmall) continue;
            if (img.width && img.height && img.width > img.height) {
                mediaGalleryImage = img.url;
                break;
            }
        }
    }

    if (mediaGalleryImage) {

    } else {
        for (const img of validImages) {
            if (!img.isSmall) {
                thumbnailImage = img.url;
                break;
            }
        }
    }

    if (thumbnailImage) {
        thumbnailUrl = thumbnailImage;
    } else if (validDomainLogo && domainLogoUrl) {
        thumbnailUrl = domainLogoUrl;
    } else if (validDefaultLogo) {
        thumbnailUrl = defaultLogo;
    }

    if (mediaGalleryImage) {
        try {
            mediaGallery = new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(mediaGalleryImage)
            );
        } catch (err) {
            mediaGallery = null;
        }
    }

    let cleanedSnippet = res.snippet || '';
    if ((engineName === 'google' || engineName === 'bing') && cleanedSnippet) {
        const dateMatch = cleanedSnippet.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\s*\.{3}/);
        if (dateMatch && !res.date) {
            cleanedSnippet = cleanedSnippet.replace(dateMatch[0], '').trim();
        }
        const lines = cleanedSnippet.split('\n');
        const uniqueLines = [];
        const seenLines = new Set();
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !seenLines.has(trimmed)) {
                seenLines.add(trimmed);
                uniqueLines.push(line);
            }
        }
        cleanedSnippet = uniqueLines.join('\n');
    }

    let imdbData = null;
    if (OMDB_API_KEY) {
        const imdbMatch = res.link?.match(/imdb\.com\/(?:title|name)\/(tt\d{7,8}|nm\d{7,8})/i);
        if (imdbMatch) {
            const imdbId = imdbMatch[1];
            imdbData = await fetchImdbRating(imdbId);
        }
    }

    let wikipediaData = null;
    if (!profanityDetected && (res.link?.includes('wikipedia.org') || domain?.includes('wikipedia.org'))) {
        const titleMatch = res.link?.match(/wikipedia\.org\/wiki\/([^?#]+)/);
        if (titleMatch) {
            const pageTitle = decodeURIComponent(titleMatch[1].replace(/_/g, ' '));
            try {
                const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
                const wikiResponse = await axios.get(wikiUrl, {
                    timeout: 3000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Waterfall/1.0)' }
                });
                if (wikiResponse.data) {
                    wikipediaData = {
                        title: wikiResponse.data.title,
                        extract: wikiResponse.data.extract,
                        description: wikiResponse.data.description,
                        thumbnail: wikiResponse.data.thumbnail?.source
                    };
                }
            } catch (err) {
                console.log("Error fetching Wikipedia data:", err.message);
            }
        }
    }

    const orderedContent = [];

    if (dateString) orderedContent.push(dateString);

    if (engineName === 'google' && res.pagemap && page === 1) {
        if (res.pagemap.person && Array.isArray(res.pagemap.person) && res.pagemap.person[0]) {
            const person = res.pagemap.person[0];
            if (person.name) orderedContent.push(`-# **${t('commands:search.meta.name')}:** ${person.name}`);
            if (person.alternatename) orderedContent.push(`-# **${t('commands:search.meta.also_known_as')}:** ${person.alternatename}`);
            if (person.disambiguatingdescription) orderedContent.push(`-# **${t('commands:search.meta.verified')}:** ${person.disambiguatingdescription}`);
        }

        if (res.pagemap.interactioncounter && Array.isArray(res.pagemap.interactioncounter)) {
            const interactionMap = {};
            res.pagemap.interactioncounter.forEach(counter => {
                if (counter.name && counter.userinteractioncount) {
                    const cleanName = counter.name.replace(/^\d+\.\s*/, '').trim();
                    interactionMap[cleanName] = counter.userinteractioncount;
                }
            });

            const significantMetrics = ['Tweets', 'Following', 'Followers', 'Likes', 'Retweets', 'Replies', 'Views'];
            significantMetrics.forEach(metric => {
                if (interactionMap[metric]) {
                    const key = metric.toLowerCase();
                    orderedContent.push(`-# **${t(`commands:search.social.${key}`) || metric}:** ${interactionMap[metric]}`);
                }
            });

            Object.keys(interactionMap).forEach(key => {
                if (!significantMetrics.includes(key) && !key.includes('interactiontype')) {
                    orderedContent.push(`-# **${key}:** ${interactionMap[key]}`);
                }
            });
        }

        if (res.pagemap.socialmediaposting && Array.isArray(res.pagemap.socialmediaposting) && res.pagemap.socialmediaposting[0]) {
            const posting = res.pagemap.socialmediaposting[0];
            if (posting.commentcount) orderedContent.push(`-# **${t('commands:search.meta.comments')}:** ${posting.commentcount}`);
            if (posting.datecreated && !dateString) {
                try {
                    const postDate = new Date(posting.datecreated);
                    if (!isNaN(postDate.getTime())) {
                        const postTimestamp = Math.floor(postDate.getTime() / 1000);
                        orderedContent.push(`-# **${t('commands:search.meta.posted')}:** <t:${postTimestamp}:R>`);
                    }
                } catch (err) {
                    console.log("Error parsing post date:", err);
                }
            }
            if (posting.articlebody && posting.articlebody.length > cleanedSnippet.length) {
                cleanedSnippet = posting.articlebody;
            }
        }

        if (res.pagemap.metatags && Array.isArray(res.pagemap.metatags) && res.pagemap.metatags[0]) {
            const metatags = res.pagemap.metatags[0];
            if (metatags['og:site_name']) orderedContent.push(`-# **${t('commands:search.meta.platform')}:** ${metatags['og:site_name']}`);
            if (metatags['twitter:creator']) orderedContent.push(`-# **${t('commands:search.meta.creator')}:** ${metatags['twitter:creator']}`);
            if (metatags['rating']) orderedContent.push(`-# **${t('commands:search.meta.content_rating')}:** ${metatags['rating']}`);
            if (metatags['language']) orderedContent.push(`-# **${t('commands:search.meta.language')}:** ${metatags['language']}`);
            if (metatags['article:author']) {
                const authorUrl = metatags['article:author'];
                const authorName = authorUrl.split('/').pop();
                orderedContent.push(`-# **${t('commands:search.meta.author')}:** ${authorName}`);
            }
        }

        if (res.pagemap.review && Array.isArray(res.pagemap.review) && res.pagemap.review[0]) {
            const review = res.pagemap.review[0];
            if (review.author) orderedContent.push(`-# **${t('commands:search.meta.review_author')}:** ${review.author}`);
            if (review.ratingvalue) orderedContent.push(`-# **${t('commands:search.meta.rating')}:** ${review.ratingvalue}/5`);
            if (review.reviewbody) orderedContent.push(`-# **${t('commands:search.meta.review')}:** ${review.reviewbody.slice(0, 100)}...`);
        }

        if (res.pagemap.aggregaterating && Array.isArray(res.pagemap.aggregaterating) && res.pagemap.aggregaterating[0]) {
            const rating = res.pagemap.aggregaterating[0];
            if (rating.ratingvalue) orderedContent.push(`-# **${t('commands:search.meta.average_rating')}:** ${rating.ratingvalue}/5`);
            if (rating.ratingcount) orderedContent.push(`-# **${t('commands:search.meta.rating_count')}:** ${rating.ratingcount}`);
            if (rating.bestrating) orderedContent.push(`-# **${t('commands:search.meta.best_rating')}:** ${rating.bestrating}`);
        }

        if (res.pagemap.product && Array.isArray(res.pagemap.product) && res.pagemap.product[0]) {
            const product = res.pagemap.product[0];
            if (product.brand) orderedContent.push(`-# **${t('commands:search.meta.brand')}:** ${product.brand}`);
            if (product.price) orderedContent.push(`-# **${t('commands:search.meta.price')}:** ${product.price}`);
            if (product.availability) orderedContent.push(`-# **${t('commands:search.meta.availability')}:** ${product.availability}`);
        }

        if (res.pagemap.event && Array.isArray(res.pagemap.event) && res.pagemap.event[0]) {
            const event = res.pagemap.event[0];
            if (event.location) orderedContent.push(`-# **${t('commands:search.meta.location')}:** ${event.location}`);
            if (event.startdate) {
                try {
                    const eventDate = new Date(event.startdate);
                    if (!isNaN(eventDate.getTime())) {
                        const eventTimestamp = Math.floor(eventDate.getTime() / 1000);
                        orderedContent.push(`-# **${t('commands:search.meta.event_date')}:** <t:${eventTimestamp}:R>`);
                    }
                } catch (err) {
                    console.error("Error parsing event date:", err);
                }
            }
        }


        if (res.pagemap.organization && Array.isArray(res.pagemap.organization) && res.pagemap.organization[0]) {
            const org = res.pagemap.organization[0];
            if (org.name) orderedContent.push(`-# **${t('commands:search.meta.organization')}:** ${org.name}`);
            if (org.url) orderedContent.push(`-# **${t('commands:search.meta.organization_url')}:** ${org.url}`);
        }


        if (!imdbData && (res.link?.includes('imdb.com/title/') || res.displayLink?.includes('imdb.com'))) {
            if (res.pagemap?.metatags && Array.isArray(res.pagemap.metatags) && res.pagemap.metatags[0]) {
                const tags = res.pagemap.metatags[0];

                const titleStr = tags['og:title'] || tags['twitter:title'];
                const descStr = tags['og:description'] || tags['twitter:description'];


                if (titleStr) {
                    const parts = titleStr.split('|');
                    const leftPart = parts[0]?.trim();
                    const genre = parts[1]?.trim();

                    if (leftPart) {
                        const starMatch = leftPart.match(/(?:⭐|★)\s*(\d+(?:\.\d+)?)/) || leftPart.match(/(\d+\.\d+)\/10/);
                        if (starMatch) {
                            orderedContent.push(`-# **${t('commands:search.imdb.rating')}:** ${starMatch[1]}/10`);
                        }
                    }
                    if (genre) {
                        orderedContent.push(`-# **${t('commands:search.imdb.genre')}:** ${genre}`);
                    }
                }

                if (descStr) {
                    const parts = descStr.split('|');
                    const runtime = parts[0]?.trim();
                    const rated = parts[1]?.trim();

                    if (runtime && /\d/.test(runtime)) {
                        orderedContent.push(`-# **${t('commands:search.imdb.runtime')}:** ${runtime}`);
                    }
                    if (rated) {
                        orderedContent.push(`-# **${t('commands:search.imdb.rated')}:** ${rated}`);
                    }
                }
            }
        }
    }

    if (imdbData) {
        if (imdbData.title) {
            const typeLabel = imdbData.type === 'series' ? t('commands:search.imdb.series') :
                imdbData.type === 'movie' ? t('commands:search.imdb.movie') :
                    imdbData.type?.toUpperCase() || t('commands:search.imdb.media');
            orderedContent.push(`-# **${typeLabel}:** ${imdbData.title}${imdbData.year ? ` (${imdbData.year})` : ''}`);
        }
        if (imdbData.rating) orderedContent.push(`-# **${t('commands:search.imdb.rating')}:** ${imdbData.rating}`);
        if (imdbData.metascore && imdbData.metascore !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.metascore')}:** ${imdbData.metascore}`);
        if (imdbData.rated && imdbData.rated !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.rated')}:** ${imdbData.rated}`);
        if (imdbData.released && imdbData.released !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.released')}:** ${imdbData.released}`);
        if (imdbData.runtime && imdbData.runtime !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.runtime')}:** ${imdbData.runtime}`);
        if (imdbData.genre && imdbData.genre !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.genre')}:** ${imdbData.genre}`);
        if (imdbData.director && imdbData.director !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.director')}:** ${imdbData.director}`);
        if (imdbData.writer && imdbData.writer !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.writer')}:** ${imdbData.writer}`);
        if (imdbData.actors && imdbData.actors !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.cast')}:** ${imdbData.actors}`);
        if (imdbData.language && imdbData.language !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.language')}:** ${imdbData.language}`);
        if (imdbData.country && imdbData.country !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.country')}:** ${imdbData.country}`);
        if (imdbData.totalSeasons && imdbData.totalSeasons !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.total_seasons')}:** ${imdbData.totalSeasons}`);
        if (imdbData.imdbVotes && imdbData.imdbVotes !== 'N/A') orderedContent.push(`-# **${t('commands:search.imdb.votes')}:** ${imdbData.imdbVotes}`);
        if (imdbData.ratings && Array.isArray(imdbData.ratings)) {
            imdbData.ratings.forEach(rating => {
                if (rating.Source && rating.Value && rating.Source !== 'Internet Movie Database') {
                    orderedContent.push(`-# **${rating.Source}:** ${rating.Value}`);
                }
            });
        }
        if (imdbData.website && imdbData.website !== 'N/A') {
            const truncatedUrl = imdbData.website.length > 512 ? imdbData.website.substring(0, 509) + '...' : imdbData.website;
            extraButtons.push({ url: truncatedUrl, type: t('commands:search.imdb.website') });
        }
        if (imdbData.plot || cleanedSnippet) {
            orderedContent.push('');
        }
        if (imdbData.plot && imdbData.plot !== 'N/A') {
            orderedContent.push(`-# **${t('commands:search.imdb.plot')}:** ${imdbData.plot.slice(0, 250)}...`);
        }
    }

    if (engineName === 'bing' && res.rich_snippet && res.rich_snippet.extensions && !imdbData) {
        res.rich_snippet.extensions.slice(0, 10).forEach(ext => {
            orderedContent.push(`-# ${ext}`);
        });
        if (cleanedSnippet) {
            orderedContent.push('');
        }
    }

    if (wikipediaData) {
        let wikiDescription = wikipediaData.description || '';
        const wikiExtract = wikipediaData.extract || '';
        let finalWikiText = '';
        if (wikiExtract.length > (wikiDescription.length + 50)) {
            finalWikiText = wikiExtract;
        } else if (wikiDescription) {
            finalWikiText = wikiDescription;
        }

        let bornMatch = finalWikiText.match(/\(born\s+([^)]+)\)/i);

        if (!bornMatch && cleanedSnippet) {
            bornMatch = cleanedSnippet.match(/\(born\s+([^)]+)\)/i);
        }

        if (bornMatch) {
            try {
                let bornDateStr = bornMatch[1];
                const dateOnlyMatch = bornDateStr.match(/([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
                if (dateOnlyMatch) {
                    bornDateStr = dateOnlyMatch[1];
                }

                const bornDate = new Date(bornDateStr);
                if (!isNaN(bornDate.getTime())) {
                    const bornTimestamp = Math.floor(bornDate.getTime() / 1000);
                    orderedContent.push(`-# **${t('commands:search.meta.born')}:** <t:${bornTimestamp}:D>`);
                } else {
                    console.debug("[Search] Invalid date parsed");
                }
                finalWikiText = finalWikiText.replace(bornMatch[0], '').replace(/\s{2,}/g, ' ').trim();
            } catch (err) {
                console.error("Error parsing birth date:", err);
            }
        }

        let normalizedSnippet = cleanedSnippet || '';
        if (normalizedSnippet) {
            normalizedSnippet = normalizedSnippet.replace(/\(born\s+[^)]+\)/i, '').replace(/\s{2,}/g, ' ').trim();
        }

        const isDuplicate = finalWikiText && normalizedSnippet &&
            (normalizedSnippet.includes(finalWikiText.substring(0, 100)) ||
                finalWikiText.includes(normalizedSnippet.substring(0, 100)));

        if (finalWikiText && !isDuplicate) {
            orderedContent.push(`-# **${t('commands:search.meta.wikipedia')}:** ${finalWikiText.slice(0, 1500)}...`);
        } else if (isDuplicate && finalWikiText.length > cleanedSnippet.length) {
            replaceSnippetWithWiki = finalWikiText;
        }
    }

    let finalDescriptionText = cleanedSnippet;
    if (replaceSnippetWithWiki && !imdbData?.plot) {
        finalDescriptionText = replaceSnippetWithWiki;
    }

    if (orderedContent.length > 0 && finalDescriptionText) {
        if (orderedContent[orderedContent.length - 1] !== '') {
            orderedContent.push('');
        }
    }
    if (finalDescriptionText &&
        !finalDescriptionText.startsWith('YouTubewww.') &&
        !finalDescriptionText.startsWith('Wikipediaen.') &&
        !finalDescriptionText.startsWith('Adult Swimwww.') &&
        finalDescriptionText.length > 20) {
        if (engineName === 'yahoo' && res.displayed_link) {
            const cleanSnippet = finalDescriptionText.trim();
            const cleanDisplayedLink = res.displayed_link.trim();
            if (cleanSnippet === cleanDisplayedLink ||
                cleanDisplayedLink.includes(cleanSnippet) ||
                (cleanSnippet.includes('www.') && cleanSnippet.split(' ').length < 3)) {
                console.log("Skipping Yahoo snippet that looks like a URL");
            } else {
                orderedContent.push(finalDescriptionText.slice(0, 2000));
            }
        } else {
            orderedContent.push(finalDescriptionText.slice(0, 2000));
        }
    }

    if (orderedContent.length === 0 || (orderedContent.length === 1 && orderedContent[0] === '')) {
        orderedContent.push(`-# ${t('common:no_results')} `);
    }

    let markdown = orderedContent.join('\n');
    if (markdown.length > 4000) {
        markdown = markdown.substring(0, 3997) + '...';
    }
    let markdown2 = `# ${emoji} ${res.title || query}\n`;
    markdown2 += `-# 🔗 [${domain}](${res.link})\n`;

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(markdown2));

    const actionRowButtons = [
        new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t('common:pagination.prev'))
            .setCustomId(serpPrevId)
            .setDisabled(page === 1 || expired),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t('common:pagination.next'))
            .setCustomId(serpNextId)
            .setDisabled(page === totalPages || expired),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(t('common:visit'))
            .setURL(res.link.length > 512 ? res.link.substring(0, 509) + '...' : res.link)
    ];

    extraButtons.slice(0, 2).forEach((btn, index) => {
        const truncatedUrl = btn.url.length > 512 ? btn.url.substring(0, 509) + '...' : btn.url;
        actionRowButtons.push(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(btn.type)
                .setURL(truncatedUrl)
        );
    });

    const actionRow = new ActionRowBuilder().addComponents(...actionRowButtons);

    const container = new ContainerBuilder()
        .setAccentColor(color);
    if (specialBuilder && page === 1) specialBuilder(container);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(markdown)
        );

    if (mediaGallery) {
        container.addMediaGalleryComponents(mediaGallery);
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );
    }

    container
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: page, total: totalPages })}`)
        )
        .addActionRowComponents(actionRow);

    return container;
}

const WIKIPEDIA_AUTOCOMPLETE_CACHE = new Map();
const WIKIPEDIA_RATE_LIMIT = new Map();
const WIKIPEDIA_COOLDOWN = 500;
const WIKIPEDIA_CACHE_TTL = 5 * 60 * 1000;
const WIKIPEDIA_CACHE_MAX_SIZE = 100;
const WIKIPEDIA_USER_AGENT = 'Waterfall/1.0 (Discord Bot; devseige@gmail.com)';

async function getWikipediaAutocomplete(query, userId) {
    logger.debug(`[Wikipedia Autocomplete] Called with query="${query}", userId=${userId}`);

    const cached = WIKIPEDIA_AUTOCOMPLETE_CACHE.get(query);
    if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < WIKIPEDIA_CACHE_TTL) {
            logger.debug(`[Wikipedia Autocomplete] Cache hit for "${query}": ${cached.results.length} results (age: ${Math.floor(age / 1000)}s)`);
            return cached.results;
        } else {
            logger.debug(`[Wikipedia Autocomplete] Cache expired for "${query}" (age: ${Math.floor(age / 1000)}s)`);
            WIKIPEDIA_AUTOCOMPLETE_CACHE.delete(query);
        }
    }

    const now = Date.now();
    const lastRequest = WIKIPEDIA_RATE_LIMIT.get(userId) || 0;
    if (now - lastRequest < WIKIPEDIA_COOLDOWN) {
        logger.debug(`[Wikipedia Autocomplete] Rate limited for userId=${userId}, skipping API call`);
        for (const [key, entry] of WIKIPEDIA_AUTOCOMPLETE_CACHE) {
            const age = Date.now() - entry.timestamp;
            if (age >= WIKIPEDIA_CACHE_TTL) continue;
            if (query.startsWith(key) && entry.results.length > 0) {
                const filtered = entry.results.filter(s => s.toLowerCase().includes(query.toLowerCase()));
                logger.debug(`[Wikipedia Autocomplete] Using filtered prefix cache from "${key}": ${filtered.length} results`);
                return filtered;
            }
        }
        return [];
    }
    WIKIPEDIA_RATE_LIMIT.set(userId, now);

    try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=25&namespace=0&format=json`;
        logger.debug(`[Wikipedia Autocomplete] Fetching: ${url}`);
        const res = await axios.get(url, {
            timeout: 3000,
            headers: {
                'User-Agent': WIKIPEDIA_USER_AGENT
            }
        });
        logger.debug(`[Wikipedia Autocomplete] Response status: ${res.status}`);
        const suggestions = res.data[1] || [];
        logger.debug(`[Wikipedia Autocomplete] Got ${suggestions.length} suggestions`);

        if (WIKIPEDIA_AUTOCOMPLETE_CACHE.size >= WIKIPEDIA_CACHE_MAX_SIZE) {
            const oldestKey = WIKIPEDIA_AUTOCOMPLETE_CACHE.keys().next().value;
            WIKIPEDIA_AUTOCOMPLETE_CACHE.delete(oldestKey);
            logger.debug(`[Wikipedia Autocomplete] Cache limit reached, removed oldest entry: "${oldestKey}"`);
        }

        WIKIPEDIA_AUTOCOMPLETE_CACHE.set(query, {
            results: suggestions,
            timestamp: Date.now()
        });
        return suggestions;
    } catch (err) {
        logger.error(`[Wikipedia Autocomplete] Error fetching suggestions: ${err.message}`);
        logger.debug(`[Wikipedia Autocomplete] Full error:`, err);
        return [];
    }
}


async function getDdgAutocomplete(query, userId) {
    logger.debug(`[DDG Autocomplete] Called with query="${query}", userId=${userId}`);

    const cached = DDG_AUTOCOMPLETE_CACHE.get(query);
    if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < DDG_CACHE_TTL) {
            logger.debug(`[DDG Autocomplete] Cache hit for "${query}": ${cached.results.length} results`);
            return cached.results;
        } else {
            DDG_AUTOCOMPLETE_CACHE.delete(query);
        }
    }

    const now = Date.now();
    const lastRequest = DDG_RATE_LIMIT.get(userId) || 0;
    if (now - lastRequest < DDG_COOLDOWN) {
        logger.debug(`[DDG Autocomplete] Rate limited for userId=${userId}`);
        for (const [key, entry] of DDG_AUTOCOMPLETE_CACHE) {
            if (Date.now() - entry.timestamp >= DDG_CACHE_TTL) continue;
            if (query.toLowerCase().startsWith(key.toLowerCase()) && entry.results.length > 0) {
                const filtered = entry.results.filter(s => s.toLowerCase().includes(query.toLowerCase()));
                logger.debug(`[DDG Autocomplete] Using prefix cache from "${key}"`);
                return filtered;
            }
        }
        return [];
    }
    DDG_RATE_LIMIT.set(userId, now);

    try {
        const suggestions = await ddg.ddgAutocomplete(query);

        if (suggestions.length > 0) {
            const joined = suggestions.join(' ||| ');
            const filteredString = await filterQuery(joined);

            if (filteredString === '[REDACTED]') {
                return [];
            }

            const filteredSuggestions = filteredString.split(' ||| ');
            const safeSuggestions = [];
            for (let i = 0; i < suggestions.length && i < filteredSuggestions.length; i++) {
                const original = suggestions[i];
                const filtered = filteredSuggestions[i];
                if (original === filtered && !filtered.includes('----')) {
                    safeSuggestions.push(original);
                }
            }

            if (DDG_AUTOCOMPLETE_CACHE.size >= DDG_CACHE_MAX_SIZE) {
                const oldestKey = DDG_AUTOCOMPLETE_CACHE.keys().next().value;
                DDG_AUTOCOMPLETE_CACHE.delete(oldestKey);
            }

            DDG_AUTOCOMPLETE_CACHE.set(query, {
                results: safeSuggestions,
                timestamp: Date.now()
            });
            return safeSuggestions;
        }

        return [];
    } catch (err) {
        logger.error(`[DDG Autocomplete] Error: ${err.message}`);
        return [];
    }
}


async function handleWikipedia(interaction, query, page = 1, isPagination = false, sessionId = null, t) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId('wiki', query, userId);
    let articles, totalPages;

    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        try {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=20&format=json`;
            const searchRes = await axios.get(searchUrl, {
                timeout: 5000,
                headers: { 'User-Agent': WIKIPEDIA_USER_AGENT }
            });
            const searchResults = searchRes.data?.query?.search || [];
            if (!searchResults.length) {
                return interaction.editReply({ content: `${e.not_found} ${t('commands:search.wikipedia.no_article_found')}` });
            }
            const articlePromises = searchResults.slice(0, 10).map(async (sr) => {
                try {
                    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sr.title)}`;
                    const summaryRes = await axios.get(summaryUrl, {
                        timeout: 3000,
                        headers: { 'User-Agent': WIKIPEDIA_USER_AGENT }
                    });
                    return summaryRes.data;
                } catch {
                    return null;
                }
            });
            articles = (await Promise.all(articlePromises)).filter(a => a && a.extract);
            if (!articles.length) {
                return interaction.editReply({ content: `${e.not_found} ${t('commands:search.wikipedia.no_article_found')}` });
            }
            totalPages = articles.length;
            setPaginationCache(sid, articles, { query, totalPages }, userId);
        } catch (err) {
            logger.error(`[Wikipedia Search] Error searching for "${query}": ${err.message}`);
            logger.debug(`[Wikipedia Search] Full error:`, err);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'Wikipedia' })}` });
        }
    } else {
        const cache = getPaginationCache(sid);
        if (!cache) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        articles = cache.results;
        totalPages = cache.meta.totalPages;
        await interaction.deferUpdate();
    }

    const currentPage = Math.max(1, Math.min(page, totalPages));
    const article = articles[currentPage - 1];
    const wikiEmoji = e.icon_wikipedia || '📖';
    const wikiLogoUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/220px-Wikipedia-logo-v2.svg.png';
    const articleUrl = article.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
    const prevId = `search_wiki_prev_${currentPage - 1}_${sid}`;
    const nextId = `search_wiki_next_${currentPage + 1}_${sid}`;

    const thumb = article.thumbnail;
    const originalImg = article.originalimage;
    let useLandscapeGallery = false;
    let galleryImageUrl = null;
    let thumbnailUrl = wikiLogoUrl;

    if (thumb && thumb.width && thumb.height) {
        if (thumb.width > thumb.height) {
            useLandscapeGallery = true;
            galleryImageUrl = thumb.source;
            thumbnailUrl = wikiLogoUrl;
        } else {
            thumbnailUrl = thumb.source;
        }
    } else if (originalImg && originalImg.width && originalImg.height) {
        if (originalImg.width > originalImg.height) {
            useLandscapeGallery = true;
            galleryImageUrl = originalImg.source;
            thumbnailUrl = wikiLogoUrl;
        } else {
            thumbnailUrl = originalImg.source;
        }
    }

    const orderedContent = [];

    if (article.description) {
        orderedContent.push(`-# ${article.description}`);
    }

    if (article.type && article.type !== 'standard') {
        orderedContent.push(`-# **Type:** ${article.type}`);
    }

    if (article.timestamp) {
        const timestamp = Math.floor(new Date(article.timestamp).getTime() / 1000);
        orderedContent.push(`-# **Last Updated:** <t:${timestamp}:R>`);
    }

    if (article.extract) {
        orderedContent.push(`\n${article.extract.slice(0, 2000)}`);
    }

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${wikiEmoji} ${article.title}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [wikipedia.org](${articleUrl})`)
        );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.prev')).setCustomId(prevId).setDisabled(page === 1),
        new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.next')).setCustomId(nextId).setDisabled(page === totalPages),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands:search.wikipedia.read_more')).setURL(articleUrl)
    );

    const container = new ContainerBuilder()
        .setAccentColor(0x636466)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')));

    if (useLandscapeGallery && galleryImageUrl) {
        const mediaGallery = new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(galleryImageUrl)
        );
        container.addMediaGalleryComponents(mediaGallery);
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: currentPage, total: totalPages })}`));
    container.addActionRowComponents(actionRow);

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleStackOverflow(interaction, query, page = 1, isPagination = false, sessionId = null, t) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId('so', query, userId);
    let questions, totalPages;

    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        try {
            const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent(query)}&site=stackoverflow&pagesize=20&filter=withbody`;
            const res = await axios.get(url, { timeout: 5000 });
            questions = res.data?.items || [];
            if (!questions.length) {
                return interaction.editReply({ content: `${e.not_found} ${t('commands:search.stackoverflow.no_results')}` });
            }
            totalPages = Math.min(questions.length, 20);
            setPaginationCache(sid, questions.slice(0, 20), { query, totalPages }, userId);
        } catch {
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'StackOverflow' })}` });
        }
    } else {
        const cache = getPaginationCache(sid);
        if (!cache) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        questions = cache.results;
        totalPages = cache.meta.totalPages;
        await interaction.deferUpdate();
    }

    const currentPage = Math.max(1, Math.min(page, totalPages));
    const q = questions[currentPage - 1];
    const soEmoji = e.icon_stackoverflow || '📚';
    const prevId = `search_so_prev_${currentPage - 1}_${sid}`;
    const nextId = `search_so_next_${currentPage + 1}_${sid}`;

    const orderedContent = [];
    orderedContent.push(`-# **${t('commands:search.stackoverflow.votes')}:** ${funcs.abbr(q.score)} | **${t('commands:search.stackoverflow.answers')}:** ${funcs.abbr(q.answer_count)} | **${t('commands:search.stackoverflow.views')}:** ${funcs.abbr(q.view_count)}`);
    if (q.creation_date) orderedContent.push(`-# **${t('commands:search.stackoverflow.asked')}:** <t:${q.creation_date}:R>`);
    if (q.tags?.length) orderedContent.push(`-# **${t('commands:search.stackoverflow.tags')}:** ${q.tags.slice(0, 5).join(', ')}`);
    if (q.is_answered) orderedContent.push(`-# ${e.verified_check_green} ${t('commands:search.stackoverflow.accepted')}`);
    orderedContent.push('');
    const bodyText = q.body?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) || '';
    if (bodyText) orderedContent.push(funcs.decodeHtmlEntities(bodyText));

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon.png'))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${soEmoji} ${funcs.decodeHtmlEntities(q.title?.slice(0, 100)) || query}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [stackoverflow.com](${q.link})`)
        );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.prev')).setCustomId(prevId).setDisabled(page === 1),
        new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.next')).setCustomId(nextId).setDisabled(page === totalPages),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('common:visit')).setURL(q.link)
    );

    const container = new ContainerBuilder()
        .setAccentColor(0xF48024)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: currentPage, total: totalPages })}`))
        .addActionRowComponents(actionRow);

    await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleEmojipedia(interaction, emoji, page = 1, isPagination = false, sessionId = null, t) {
    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        try {
            const data = await ddgEmojipedia(emoji);
            if (!data) {
                return interaction.editReply({ content: `${e.not_found} ${t('commands:search.emojipedia.not_found')}` });
            }
            const container = buildEmojipediaEmbed(data, emoji, t);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            logger.error(`[Emojipedia] Error: ${err.message}`);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'Emojipedia' })}` });
        }
    }
}

function getWeatherEmoji(conditionCode) {
    const iconMap = {
        'Clear': '☀️',
        'MostlyClear': '🌤️',
        'PartlyCloudy': '⛅',
        'MostlyCloudy': '🌥️',
        'Cloudy': '☁️',
        'Overcast': '☁️',
        'Drizzle': '🌦️',
        'Rain': '🌧️',
        'HeavyRain': '🌧️',
        'Snow': '❄️',
        'HeavySnow': '🌨️',
        'Flurries': '🌨️',
        'Sleet': '🌨️',
        'FreezingRain': '🌧️',
        'FreezingDrizzle': '🌧️',
        'Hail': '🌨️',
        'Thunderstorms': '⛈️',
        'IsolatedThunderstorms': '⛈️',
        'ScatteredThunderstorms': '⛈️',
        'StrongStorms': '⛈️',
        'Windy': '💨',
        'Breezy': '💨',
        'Foggy': '🌫️',
        'Haze': '🌫️',
        'Smoky': '🌫️',
        'Dust': '🌫️',
        'BlowingDust': '🌫️',
        'BlowingSnow': '🌨️',
        'Tornado': '🌪️',
        'TropicalStorm': '🌀',
        'Hurricane': '🌀',
        'SunFlurries': '🌨️',
        'SunShowers': '🌦️',
        'Hot': '🔥',
        'Cold': '🥶'
    };
    return iconMap[conditionCode] || '🌡️';
}

function buildForecastEmbed(forecast, locationQuery, t, containerProp) {
    const current = forecast.currentWeather || forecast.currently || {};

    const locationRaw = forecast.location;
    const locationString = typeof locationRaw === 'string' ? locationRaw : null;
    const locationObj = typeof locationRaw === 'object' ? locationRaw : {};

    const location = locationString || forecast.name || locationObj.name || locationObj.city || forecast.flags?.['ddg-location'] || locationQuery;

    const daily = forecast.forecastDaily || forecast.daily || {};
    const hourly = forecast.forecastHourly || forecast.hourly || {};
    const alerts = forecast.weatherAlerts || forecast.alerts || [];

    logger.debug(`[DDG Forecast] currentWeather keys: ${Object.keys(current).join(', ')}`);
    if (Object.keys(current).length > 0) {
        logger.debug(`[DDG Forecast] currentWeather sample: ${JSON.stringify(current).slice(0, 300)}`);
    }

    const temp = current.temperature ?? current.temp ?? current.temperatureApparent ??
        current.value ?? current.degrees ?? '?';
    const tempRounded = typeof temp === 'number' ? Math.round(temp) : temp;
    const icon = getWeatherEmoji(current.icon || current.conditionCode || current.weatherCode);
    const feelsLike = current.temperatureApparent ?? current.apparentTemperature ?? current.feelsLike;
    const humidity = current.humidity;
    const windSpeed = current.windSpeed ?? current.wind;
    const summary = current.summary || current.conditionDescription || current.description ||
        daily.summary || '';

    const orderedContent = [];

    orderedContent.push(`## 🌡️ ${tempRounded}°C  ${summary}`);

    const currentDetails = [];
    if (feelsLike != null) currentDetails.push(`${t('commands:search.weather.feels_like')}: ${Math.round(feelsLike)}°`);
    if (humidity != null) {
        const humidityVal = humidity > 1 ? humidity : Math.round(humidity * 100);
        currentDetails.push(`💧 ${humidityVal}%`);
    }
    if (windSpeed != null) currentDetails.push(`💨 ${Math.round(windSpeed)} km/h`);
    if (currentDetails.length > 0) {
        orderedContent.push(`-# ${currentDetails.join(' | ')}`);
    }

    const hourlyData = hourly.hours || hourly.data || (Array.isArray(hourly) ? hourly : []);
    if (hourlyData.length > 0) {
        const hourlyPreview = hourlyData.slice(0, 6).map(h => {
            const hTemp = h.temperature ?? h.temp ?? h.temperatureApparent ?? '?';
            const hIcon = getWeatherEmoji(h.icon || h.conditionCode);
            return `${hIcon} ${typeof hTemp === 'number' ? Math.round(hTemp) : hTemp}°`;
        }).join(' → ');
        orderedContent.push('');
        orderedContent.push(`**${t('commands:search.weather.next_6_hours')}:** ${hourlyPreview}`);
    }

    const dailyData = daily.days || daily.data || (Array.isArray(daily) ? daily : []);
    if (dailyData.length > 0) {
        orderedContent.push('');
        orderedContent.push(`**📅 ${t('commands:search.weather.daily_forecast')}:**`);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dailyData.slice(0, 5).forEach(d => {
            let dayName = 'Day';
            if (d.time) {
                const date = new Date(typeof d.time === 'number' ? d.time * 1000 : d.time);
                dayName = days[date.getDay()];
            } else if (d.forecastStart) {
                const date = new Date(d.forecastStart);
                dayName = days[date.getDay()];
            }
            const high = d.temperatureHigh ?? d.temperatureMax ?? d.high ?? '?';
            const low = d.temperatureLow ?? d.temperatureMin ?? d.low ?? '?';
            const dIcon = getWeatherEmoji(d.icon || d.conditionCode);
            const highVal = typeof high === 'number' ? Math.round(high) : high;
            const lowVal = typeof low === 'number' ? Math.round(low) : low;
            orderedContent.push(`-# ${dayName}: ${dIcon} ${highVal}°/${lowVal}°`);
        });
    }

    const alertsArray = Array.isArray(alerts) ? alerts : [];
    if (alertsArray.length > 0) {
        orderedContent.push('');
        orderedContent.push(`${e.warning} **${alertsArray.length} ${t('commands:search.weather.alerts')}:**`);
        alertsArray.slice(0, 2).forEach(alert => {
            const alertText = alert.title || alert.headline || alert.description?.slice(0, 100) || 'Weather Alert';
            orderedContent.push(`-# ${alertText}`);
        });
    }

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://developer.apple.com/assets/elements/icons/weatherkit/weatherkit-96x96_2x.png'))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${icon == "🌡️" ? "🌤️" : icon} ${t('commands:search.weather.title', { location })}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [Apple WeatherKit](https://developer.apple.com/weatherkit/data-source-attribution/)`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0x4A90D9);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))

    if (current.asOf) {
        const asOfTime = Math.floor(new Date(current.asOf).getTime() / 1000);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${t('commands:search.weather.as_of', { dateTime: `<t:${asOfTime}:F>` })}`)
        );
    }


    return container;
}

function buildExpandUrlEmbed(data, query, t, containerProp) {
    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(data.isSafe ? 0x4A90D9 : 0xFF5252);

    const orderedContent = [];

    orderedContent.push(`## 🔗 ${t('commands:search.expand_url.title')}`);
    orderedContent.push('');
    orderedContent.push(`**${t('commands:search.expand_url.shortened')}:** \`${data.requested_url}\``);

    if (data.isSafe) {
        orderedContent.push(`**${t('commands:search.expand_url.resolved')}:** ${data.resolved_url}`);
    } else {
        orderedContent.push(`**${t('commands:search.expand_url.resolved')}:** ||${data.resolved_url}||`);
        orderedContent.push('');
        orderedContent.push(`${e.warning} **${t('commands:search.expand_url.unsafe_warning')}:** ${funcs.truncate(data.safetyReason || 'Potential security risk detected', 100)}.`);
    }

    if (data.service_safety_info) {
        orderedContent.push(`-# **Service Info:** ${funcs.truncate(data.service_safety_info, 150)}`);
    }

    const textComponent = new TextDisplayBuilder().setContent(orderedContent.join('\n'));
    const canShowButton = data.isSafe && data.resolved_url && data.resolved_url.length <= 512;

    if (canShowButton) {
        container.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(textComponent)
            .setButtonAccessory(new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(t('common:visit') || 'Visit')
                .setURL(data.resolved_url))
        );
    } else {
        container.addTextDisplayComponents(textComponent);
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${e.blurple_mod} ${t('commands:search.expand_url.note')}`));

    return container;
}

function getTwemojiUrl(emoji) {
    const codePoints = Array.from(emoji)
        .map(c => c.codePointAt(0).toString(16))
        .filter(cp => cp !== 'fe0f');
    const slug = codePoints.join('-');
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${slug}.png`;
}

function buildEmojipediaEmbed(data, emoji, t, containerProp) {
    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0x7360f2);

    let section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${data.title || emoji}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(getTwemojiUrl(emoji)));

    if (data.description) {
        const lines = data.description.replace(/\r/g, '').split(/\n+/).filter(l => l.trim().length > 0);
        if (lines.length > 0) {
            const desc = funcs.decodeHtmlEntities(funcs.truncate(lines[0], 350), 'https://emojipedia.org');
            if (desc && desc.trim()) {
                section.addTextDisplayComponents(new TextDisplayBuilder().setContent(desc.trim()));
            }
        }
    }

    if (data.alsoKnownAs && data.alsoKnownAs.length > 0) {
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# **Aliases:** ${data.alsoKnownAs.slice(0, 5).join(', ')}`));
    }

    /*if (data.url) {
        section.setButtonAccessory(new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(t('common:visit') || 'Visit')
            .setURL(data.url)
        );
    } */

    container.addSectionComponents(section);

    const technical = [];
    if (data.codepoints) technical.push(`**Codepoints:** \`${data.codepoints}\``);
    if (data.shortcodes) technical.push(`**Shortcodes:** \`${data.shortcodes}\``);
    if (data.appleName) technical.push(`**Apple Name:** ${data.appleName}`);
    if (data.emojiVersion) technical.push(`**Version:** Emoji ${data.emojiVersion}`);

    if (technical.length > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(technical.join('\n')));
    }

    return container;
}

function buildStocksEmbed(stock, symbol, t, containerProp) {
    const formatNum = (num) => {
        if (num === null || num === undefined) return '?';
        const val = Number(num);
        if (isNaN(val)) return num;
        return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const price = formatNum(stock.Last);
    const change = stock.ChangeFromPreviousClose || 0;
    const percentChange = stock.PercentChangeFromPreviousClose || 0;
    const currency = stock.Currency || 'USD';
    const isPositive = change >= 0;
    const changeEmoji = isPositive ? '📈' : '📉';
    const changeSign = isPositive ? '+' : '';
    const accentColor = isPositive ? 0x00C853 : 0xFF5252;

    const security = stock.Security || {};
    const companyName = security.Name || symbol.toUpperCase();

    const orderedContent = [];

    orderedContent.push(`## 💵 ${price} ${currency}`);
    orderedContent.push(`${changeEmoji} **${changeSign}${Math.abs(change).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}** (${changeSign}${Math.abs(percentChange).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`);
    orderedContent.push('');

    const stats = [];
    if (stock.Open != null) stats.push(`**${t('commands:search.stocks.open')}:** ${formatNum(stock.Open)}`);
    if (stock.High != null) stats.push(`**${t('commands:search.stocks.high')}:** ${formatNum(stock.High)}`);
    if (stock.Low != null) stats.push(`**${t('commands:search.stocks.low')}:** ${formatNum(stock.Low)}`);
    if (stock.Volume != null) stats.push(`**${t('commands:search.stocks.volume')}:** ${funcs.abbr(stock.Volume)}`);

    if (stats.length > 0) {
        orderedContent.push(stats.slice(0, 2).join(' | '));
        if (stats.length > 2) {
            orderedContent.push(stats.slice(2).join(' | '));
        }
    }

    if (stock.High52Weeks != null || stock.Low52Weeks != null) {
        orderedContent.push('');
        const weekStats = [];
        if (stock.High52Weeks != null) weekStats.push(`**${t('commands:search.stocks.high_52w')}:** ${formatNum(stock.High52Weeks)}`);
        if (stock.Low52Weeks != null) weekStats.push(`**${t('commands:search.stocks.low_52w')}:** ${formatNum(stock.Low52Weeks)}`);
        orderedContent.push(`-# ${weekStats.join(' | ')}`);
    }

    if (stock.PreviousClose != null) {
        orderedContent.push(`-# **${t('commands:search.stocks.prev_close')}:** ${formatNum(stock.PreviousClose)}`);
    }

    let timestamp = stock.Timestamp;
    if (!timestamp && stock.Date && stock.Time) {
        try {
            const dateStr = `${stock.Date} ${stock.Time}`.replace(/ET|EST|EDT/g, '').trim();
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
                timestamp = Math.floor(d.getTime() / 1000);
            }
        } catch (e) { }
    }
    if (timestamp) {
        orderedContent.push('');
        orderedContent.push(`-# ${t('commands:search.meta.last_updated')}: <t:${timestamp}:R>`);
    }

    const sourceName = stock.source_api || 'Xignite';
    const sourceUrl = sourceName === 'Yahoo Finance' ? 'https://finance.yahoo.com/' : 'https://www.xignite.com/';

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn3d.iconscout.com/3d/premium/thumb/stock-market-3d-icon-png-download-8747171.png'))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${changeEmoji} ${t('commands:search.stocks.title', { symbol: symbol.toUpperCase(), name: companyName })}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [${sourceName}](${sourceUrl})`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(accentColor);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))

    return container;
}

function buildCoinflipEmbed(t, containerProp) {
    const random = crypto.randomInt(0, 2);
    const result = random === 0 ? 'heads' : 'tails';
    const resultEmoji = random === 0 ? '🪙' : '🪙';
    const resultText = t(`commands:search.coinflip.${result}`);

    const headsIcon = 'https://c.tenor.com/9FKetp9PPUUAAAAC/tenor.gif';
    const tailsIcon = 'https://c.tenor.com/JCa8VnPcfp0AAAAC/tenor.gif';

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(result === 'heads' ? headsIcon : tailsIcon))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${resultEmoji} ${t('commands:search.coinflip.title')}`),
            new TextDisplayBuilder().setContent(`### ${t('commands:search.coinflip.result_label')}: **${resultText}**`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0xf1c40f);
    container.addSectionComponents(section);

    return container;
}

function buildTimeEmbed(timeResult, locationQuery, t, containerProp) {
    const locations = timeResult.locations || [];
    if (locations.length === 0) return null;

    const loc = locations[0];
    const geo = loc.geo || {};
    const timeData = loc.time || {};

    const datetime = timeData.datetime || {};
    const timezone = timeData.timezone || {};

    const locationName = geo.name || locationQuery;

    const countryName = geo.country?.name || geo.country || '';
    const displayLocation = countryName ? `${locationName}, ${countryName}` : locationName;

    const orderedContent = [];

    if (datetime.hour != null) {
        const hour = String(datetime.hour);
        const minute = String(datetime.minute ?? 0).padStart(2, '0');
        const second = String(datetime.second ?? 0).padStart(2, '0');
        const timeStr = `${hour}:${minute}:${second}`;
        orderedContent.push(`## 🕐 ${timeStr}`);
    } else if (timeData.iso) {
        try {
            const d = new Date(timeData.iso);
            orderedContent.push(`## 🕐 ${d.toLocaleTimeString()}`);
        } catch { }
    }

    if (datetime.year && datetime.month && datetime.day) {
        const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        try {
            const d = new Date(datetime.year, datetime.month - 1, datetime.day);
            const dayName = days[d.getDay()];
            const monthName = months[datetime.month];
            orderedContent.push(`📅 ${dayName}, ${monthName} ${datetime.day}, ${datetime.year}`);
        } catch {
            orderedContent.push(`📅 ${datetime.month}/${datetime.day}/${datetime.year}`);
        }
    }

    if (timezone.zonename || timezone.zoneabb) {
        orderedContent.push('');
        const tzInfo = [];
        if (timezone.zonename) tzInfo.push(`**Timezone:** ${timezone.zonename}`);
        if (timezone.zoneabb) tzInfo.push(`(${timezone.zoneabb})`);
        orderedContent.push(`-# 🌍 ${tzInfo.join(' ')}`);
    }

    if (timezone.offset) {
        orderedContent.push(`-# **${t('commands:search.time.utc_offset')}:** ${timezone.offset}`);
    }

    if (timezone.zonedst != null) {
        orderedContent.push(`-# **${t('commands:search.time.dst_active')}:** ${timezone.zonedst > 0 ? t('common:yes') : t('common:no')}`);
    }

    const thumbnailUrl = 'https://cdn3d.iconscout.com/3d/premium/thumb/clock-3d-icon-png-download-7097715.png';

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${t('commands:search.time.title', { location: displayLocation })}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [TimeAndDate.com](https://www.timeanddate.com/)`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0x9C27B0);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))

    return container;
}

function buildCurrencyEmbed(currencyResult, from, to, amount, t, containerProp) {
    const conversion = currencyResult.conversion || {};
    const topConversions = currencyResult.topConversions || [];

    function formatMoney(val) {
        if (!val) return '?';
        const num = parseFloat(val);
        if (isNaN(num)) return val;
        return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    const fromAmount = formatMoney(conversion['from-amount'] || amount);
    const fromCurrency = conversion['from-currency-symbol'] || from;
    const toAmount = formatMoney(conversion['converted-amount']);
    const toCurrency = conversion['to-currency-symbol'] || to;
    const rate = conversion['conversion-rate'];

    function getCurrencyEmoji(code) {
        const mapping = {
            'USD': '💵',
            'EUR': '💶',
            'GBP': '💷',
            'JPY': '💴',
            'CNY': '💴',
            'KRW': '₩',
            'INR': '₹',
            'BTC': '₿',
            'ETH': 'Ξ'
        };
        return mapping[code.toUpperCase()] || '🪙';
    }

    const orderedContent = [];

    orderedContent.push(`## ${getCurrencyEmoji(fromCurrency)} ${fromAmount} ${fromCurrency} = ${getCurrencyEmoji(toCurrency)} ${toAmount} ${toCurrency}`);

    if (rate) {
        orderedContent.push(`-# **${t('commands:search.currency.rate')}:** 1 ${fromCurrency} = ${rate} ${toCurrency}`);
    }

    if (topConversions.length > 0) {
        orderedContent.push('');
        orderedContent.push(`**${t('commands:search.currency.other_conversions')}:**`);
        topConversions.slice(0, 5).forEach(conv => {
            if (conv['to-currency-symbol'] !== toCurrency) {
                const symbol = conv['to-currency-symbol'] || '';
                const convAmount = formatMoney(conv['converted-amount']);
                orderedContent.push(`-# ${fromAmount} ${fromCurrency} = ${convAmount} ${symbol}`);
            }
        });
    }

    const headers = currencyResult.headers || {};
    if (headers['utc-timestamp']) {
        orderedContent.push('');
        try {
            const timestamp = Math.floor(new Date(headers['utc-timestamp']).getTime() / 1000);
            orderedContent.push(`-# Updated: <t:${timestamp}:R>`);
        } catch { }
    }

    const isExchangeApi = currencyResult.source_api === 'ExchangeRate-API';
    const sourceIcon = 'https://static.vecteezy.com/system/resources/previews/071/064/273/non_2x/3d-icon-money-bag-in-hand-free-png.png';
    const sourceName = isExchangeApi ? 'ExchangeRate-API' : 'XE.com';
    const sourceUrl = isExchangeApi ? 'https://www.exchangerate-api.com/' : 'https://www.xe.com/';

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(sourceIcon))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 💱 Currency Conversion`),
            new TextDisplayBuilder().setContent(`-# 🔗 [${sourceName}](${sourceUrl})`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0xFFB300);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))

    return container;
}

function buildDictionaryEmbed(data, word, t, containerProp) {
    const phonetic = data.phonetic || (data.phonetics && data.phonetics[0]?.text) || '';
    const meanings = data.meanings || [];

    let defText = meanings.slice(0, 3).map(meaning => {
        let defs = meaning.definitions.slice(0, 3).map((def, i) => {
            let line = `**${i + 1}.** ${def.definition}`;
            if (def.example) line += `\n> _${def.example}_`;
            return line;
        }).join('\n\n');
        let syns = meaning.synonyms && meaning.synonyms.length ? `\n> **${t('common:synonyms')}:** ${meaning.synonyms.slice(0, 3).join(', ')}` : '';
        let ants = meaning.antonyms && meaning.antonyms.length ? `\n> **${t('common:antonyms')}:** ${meaning.antonyms.slice(0, 3).join(', ')}` : '';
        return `*${meaning.partOfSpeech}*${syns}${ants}\n${defs}`;
    }).join('\n\n');

    if (!defText) defText = t('commands:search.dictionary.no_definitions');
    if (defText.length > 2000) {
        defText = defText.slice(0, 1997) + '...';
    }

    const orderedContent = [];
    orderedContent.push(defText);

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://cdn-icons-png.flaticon.com/512/2991/2991148.png'))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 📖 ${data.word}${phonetic ? ` (${phonetic})` : ''}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [Dictionary API](https://dictionaryapi.dev/)`)
        );

    const container = containerProp || new ContainerBuilder();
    if (!containerProp) container.setAccentColor(0x0074D9);
    container
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')))

    if (Array.isArray(data.sourceUrls) && data.sourceUrls.length > 0) {
        const sourceButtons = data.sourceUrls.slice(0, 3).map((url, i) =>
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(data.sourceUrls.length === 1 ? t('common:source') : `${t('common:source')} ${i + 1}`)
                .setURL(url)
        );
        const sourceRow = new ActionRowBuilder().addComponents(...sourceButtons);
        container.addActionRowComponents(sourceRow);
    }

    return container;
}

async function buildNewsSearchEmbed(news, page, totalPages, query, sessionId, t) {
    const prevId = `search_ddg_news_prev_${page - 1}_${sessionId}`;
    const nextId = `search_ddg_news_next_${page + 1}_${sessionId}`;

    const orderedContent = [];

    if (news.source) {
        orderedContent.push(`-# 🔗 **${t('common:source')}:** ${news.source}`);
    }

    if (news.date) {
        try {
            const timestamp = typeof news.date === 'number' ? news.date : Math.floor(new Date(news.date).getTime() / 1000);
            if (!isNaN(timestamp)) {
                orderedContent.push(`-# 📅 **${t('commands:search.news.published')}:** <t:${timestamp}:R>`);
            }
        } catch { }
    }

    if (news.syndicate) {
        orderedContent.push(`-# 🔗 **${t('commands:search.news.syndicate')}:** ${news.syndicate}`);
    }

    if (news.excerpt || news.body) {
        orderedContent.push('');
        const excerpt = news.excerpt || news.body;
        orderedContent.push(funcs.decodeHtmlEntities(excerpt.slice(0, 800)));
    }

    const engineLogo = 'https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/duckduckgo-icon.png';
    let thumbnailUrl = engineLogo;
    let mediaGallery = null;

    if (news.image) {
        const info = await funcs.getImageInfo(news.image);
        if (info.isValid) {
            const width = news.width || news.imageWidth || news.ImageWidth || news.image_width || info.width;
            const height = news.height || news.imageHeight || news.ImageHeight || news.image_height || info.height;

            if (width && height && width > height) {
                try {
                    mediaGallery = new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(news.image).setDescription(news.title?.slice(0, 100) || 'News image')
                    );
                } catch (err) {
                    logger.debug(`[DDG News] Failed to create gallery: ${err.message}`);
                }
                thumbnailUrl = engineLogo;
            } else {
                thumbnailUrl = news.image;
            }
        }
    }

    if (thumbnailUrl === engineLogo && news.url) {
        try {
            const domain = new URL(news.url).hostname;
            const domainLogoUrl = `https://logo.clearbit.com/${domain}`;
            if (await funcs.isImageUrl(domainLogoUrl)) {
                thumbnailUrl = domainLogoUrl;
            }
        } catch { }
    }

    const section = new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 📰 ${funcs.decodeHtmlEntities(news.title.slice(0, 200))}`),
            new TextDisplayBuilder().setContent(`-# 🔗 [DuckDuckGo News](https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&ia=news)`)
        );

    const actionRowButtons = [
        new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t('common:pagination.prev'))
            .setCustomId(prevId)
            .setDisabled(page === 1),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t('common:pagination.next'))
            .setCustomId(nextId)
            .setDisabled(page === totalPages)
    ];

    if (news.url) {
        const newsUrlTruncated = news.url.length > 512 ? news.url.substring(0, 509) + '...' : news.url;
        actionRowButtons.push(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(t('commands:search.news.read_article'))
                .setURL(newsUrlTruncated)
        );
    }

    if (news.relatedStories && news.relatedStories.length > 0 && news.relatedStories[0].url) {
        const relatedUrl = news.relatedStories[0].url;
        const relatedUrlTruncated = relatedUrl.length > 512 ? relatedUrl.substring(0, 509) + '...' : relatedUrl;
        actionRowButtons.push(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel(t('commands:search.news.related'))
                .setURL(relatedUrlTruncated)
        );
    }

    const actionRow = new ActionRowBuilder().addComponents(...actionRowButtons.slice(0, 5));

    const container = new ContainerBuilder()
        .setAccentColor(0x1E88E5)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(orderedContent.join('\n')));

    if (mediaGallery) {
        container.addMediaGalleryComponents(mediaGallery);
    }

    container
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: page, total: totalPages })}`))
        .addActionRowComponents(actionRow);

    return container;
}

function formatDuration(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '?';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function filterQuery(query) {
    try {
        const response = await axios.get('https://www.purgomalum.com/service/json', {
            params: { text: query, fill_char: '-' }
        });
        return response.data.result || '[REDACTED]';
    } catch {
        return '[REDACTED]';
    }
}

async function getSpecialSearchComponent(queryUser, t) {
    const queryType = ddg.detectQueryType(queryUser);
    if (!queryType.type || queryType.type === 'search') return null;

    let builder = null;

    try {
        if (queryType.type === 'weather') {
            const forecast = await ddg.ddgForecast(queryType.params.location);
            if (forecast) builder = (c) => buildForecastEmbed(forecast, queryType.params.location, t, c);
        } else if (queryType.type === 'stocks') {
            const stock = await ddg.ddgStocks(queryType.params.symbol);
            if (stock && stock.Last != null) builder = (c) => buildStocksEmbed(stock, queryType.params.symbol, t, c);
        } else if (queryType.type === 'time') {
            const timeResult = await ddg.ddgTime(queryType.params.location);
            if (timeResult && timeResult.locations && timeResult.locations.length > 0) {
                builder = (c) => buildTimeEmbed(timeResult, queryType.params.location, t, c);
            }
        } else if (queryType.type === 'currency') {
            const { from, to, amount } = queryType.params;
            const currencyResult = await ddg.ddgCurrency(from, to, amount);
            if (currencyResult && currencyResult.conversion) {
                builder = (c) => buildCurrencyEmbed(currencyResult, from, to, amount, t, c);
            }
        } else if (queryType.type === 'coinflip') {
            builder = (c) => buildCoinflipEmbed(t, c);
        } else if (queryType.type === 'dictionary') {
            const word = queryType.params.word;
            const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
            try {
                const response = await axios.get(apiUrl);
                const data = response.data[0];
                if (data) builder = (c) => buildDictionaryEmbed(data, word, t, c);

            } catch { }
        } else if (queryType.type === 'expand_url') {
            const result = await ddg.ddgExpandUrl(queryType.params.url);
            if (result && (result.success || result.resolved_url)) {

                const requested = queryType.params.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
                const resolved = (result.resolved_url || result.url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

                if (requested === resolved && !result.malicious) {
                    logger.debug(`[SS] Expand URL: Requested and resolved are same ("${requested}"), skipping special page.`);
                    return null;
                }

                const data = {
                    requested_url: queryType.params.url,
                    resolved_url: result.resolved_url || result.url
                };

                const safetyRequested = await funcs.checkUrlSafety(data.requested_url);
                const safetyResolved = await funcs.checkUrlSafety(data.resolved_url);

                if (safetyRequested.error === 403 || safetyResolved.error === 403) {
                    logger.warn(`[SS] URL Safety API returned 403, skipping expansion page for safety.`);
                    return null;
                }

                data.isSafe = safetyRequested.safe && safetyResolved.safe;
                data.safetyReason = !safetyRequested.safe ? safetyRequested.reason : safetyResolved.reason;

                if (result.safety) {
                    data.service_safety_info = result.safety;
                } else if (result.malicious) {
                    data.service_safety_info = `Flagged as malicious by expansion service.`;
                    data.isSafe = false;
                }

                builder = (c) => buildExpandUrlEmbed(data, queryType.params.url, t, c);
            } else {
                logger.debug(`[SS] Expand URL failed for ${queryType.params.url}: ${result ? result.error : 'Unknown error'}`);
            }
        } else if (queryType.type === 'emojipedia') {
            const data = await ddg.ddgEmojipedia(queryType.params.emoji);
            if (data) {
                builder = (c) => buildEmojipediaEmbed(data, queryType.params.emoji, t, c);
            }
        }
    } catch (err) {
        logger.error(`[SS] Error processing ${queryType.type}: ${err.message}`);
    }

    if (builder) return { builder, isBlocking: false };
    return null;
}

async function handleDuckDuckGo(interaction, query, page = 1, profanityDetected = false, isPagination = false, sessionId = null, t, specialBuilderFromCache = null) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId('ddg', query, userId);
    let results, totalPages;
    let specialBuilder = specialBuilderFromCache;

    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();

        if (!specialBuilder) {
            const special = await getSpecialSearchComponent(query, t);
            if (special) {
                if (special.isBlocking) {
                    await interaction.editReply({ components: [special.component], flags: MessageFlags.IsComponentsV2 });
                    return;
                }
                specialBuilder = special.builder;
            }
        }

        logger.debug(`[DDG] Using JSON API for: "${query}"`);
        try {
            const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&kp=1&safe=active`;
            const response = await axios.get(apiUrl);
            const data = response.data;
            results = parseDuckDuckGoResults(data, query).slice(0, 30);
            if (profanityDetected && results.length && results[0].isAbstract) {
                results = results.slice(1);
            }
            logger.debug(`[DDG] JSON API returned ${results.length} results`);
        } catch (error) {
            logger.error(`[DDG] JSON API failed: ${error.message}`);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'DuckDuckGo' })}` });
        }

        if (!results.length) {
            if (specialBuilder) {
                const container = new ContainerBuilder().setAccentColor(0x4756ff);
                specialBuilder(container);
                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
        }
        totalPages = results.length;
        if (specialBuilder) totalPages++;
        setPaginationCache(sid, results, { query, totalPages, source: 'json', specialBuilder }, userId);
    } else {
        const cache = getPaginationCache(sid);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        results = cache.results;
        totalPages = cache.meta.totalPages;
        specialBuilder = cache.meta.specialBuilder;
        await interaction.deferUpdate();
    }

    if (specialBuilder) {
        if (page === 1) {
            const container = new ContainerBuilder().setAccentColor(0x4756ff);
            specialBuilder(container);

            const ddgNextId = `search_ddg_next_2_${sid}`;
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.prev')).setCustomId(`search_ddg_prev_0_${sid}`).setDisabled(true),
                new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.next')).setCustomId(ddgNextId).setDisabled(totalPages <= 1)
            );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            if (totalPages === 1) {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - Search`));
            } else {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: 1, total: totalPages })}`));
            }
            container.addActionRowComponents(actionRow);

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return;
        }
        const index = page - 2;
        const searchComponent = await buildDuckDuckGoComponent(results[index], page, totalPages, interaction.client, query, sid, t);
        await interaction.editReply({ components: [searchComponent], flags: MessageFlags.IsComponentsV2 });
        return;
    }

    const currentPage = Math.max(1, Math.min(page, totalPages));
    const searchComponent = await buildDuckDuckGoComponent(results[currentPage - 1], currentPage, totalPages, interaction.client, query, sid, t);

    await interaction.editReply({ components: [searchComponent], flags: MessageFlags.IsComponentsV2 });
}

async function handleDDGNews(interaction, query, page = 1, isPagination = false, sessionId = null, t) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId('ddg_news', query, userId);
    let results, totalPages;

    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();

        try {
            logger.debug(`[DDG News] Searching for: "${query}"`);
            const newsResults = await ddg.ddgSearchNews(query);

            if (!newsResults || newsResults.noResults || !newsResults.results || newsResults.results.length === 0) {
                return interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
            }

            results = newsResults.results.slice(0, 25);
            totalPages = results.length;
            setPaginationCache(sid, results, { query, totalPages, type: 'ddg_news' }, userId);
            logger.debug(`[DDG News] Found ${results.length} news articles for "${query}"`);
        } catch (error) {
            logger.error(`[DDG News] Error: ${error.message}`);
            return interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'DuckDuckGo News' })}` });
        }
    } else {
        const cache = getPaginationCache(sid);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        results = cache.results;
        totalPages = cache.meta.totalPages;
        query = cache.meta.query;
        await interaction.deferUpdate();
    }

    const currentPage = Math.max(1, Math.min(page, totalPages));
    const component = await buildNewsSearchEmbed(results[currentPage - 1], currentPage, totalPages, query, sid, t);
    await interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
}

async function handleAllLinks(interaction, query, realQuery, t) {
    const encodedQuery = encodeURIComponent(query);
    const encodedRealQuery = encodeURIComponent(realQuery || query);
    const links = [
        { name: 'Google', url: `https://google.com/search?q=${encodedRealQuery}&safe=active`, emoji: e.icon_google },
        { name: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${encodedRealQuery}&kp=1`, emoji: e.icon_duckduckgo },
        { name: 'Bing', url: `https://bing.com/search?q=${encodedRealQuery}&adlt=strict`, emoji: e.icon_bing },
        { name: 'Yandex', url: `https://yandex.com/search/?text=${encodedQuery}&family=1`, emoji: e.icon_yandex },
        { name: 'Yahoo', url: `https://search.yahoo.com/search?p=${encodedQuery}`, emoji: e.icon_yahoo },
        { name: 'Brave', url: `https://search.brave.com/search?q=${encodedQuery}&safesearch=strict`, emoji: e.icon_brave },
        { name: 'Ecosia', url: `https://www.ecosia.org/search?q=${encodedQuery}&safesearch=1`, emoji: e.icon_ecosia },
        { name: 'Qwant', url: `https://www.qwant.com/?q=${encodedQuery}&safesearch=1`, emoji: e.icon_qwant },
        { name: 'Swisscows', url: `https://swisscows.com/it/web?query=${encodedQuery}&safesearch=true`, emoji: e.icon_swisscows },
        { name: 'Gibiru', url: `https://gibiru.com/results.html?q=${encodedQuery}`, emoji: e.icon_gibiru },
        //{ name: 'Lilo', url: `https://search.lilo.org/?q=${encodedQuery}&safe=active`, emoji: e.forum }
    ];
    const embed = new ContainerBuilder()
        .setAccentColor(0x4756ff)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# ${t('commands:search.search_queries_title')}`),
            new TextDisplayBuilder().setContent(links.map(l => `${l.emoji} [${query}](${l.url})`).join('\n'))
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# Waterfall - Search')
        );
    await interaction.reply({ components: [embed], flags: MessageFlags.IsComponentsV2 });
}

async function handleSerpApiEngine(interaction, query, engineName, color, emoji, page = 1, safeQuery = null, profanityDetected = false, isPagination = false, sessionId = null, t, specialBuilderFromCache = null) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId(engineName, query, userId);
    let items, totalPages;
    let specialBuilder = specialBuilderFromCache;

    if (!safeQuery) safeQuery = query;
    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!specialBuilder) {
            const special = await getSpecialSearchComponent(query, t);
            if (special) {
                if (special.isBlocking) {
                    await interaction.editReply({ components: [special.component], flags: MessageFlags.IsComponentsV2 });
                    return;
                }
                specialBuilder = special.builder;
            }
        }

        if (engineName === 'google') {
            try {
                const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&safe=active&num=10`;
                const response = await axios.get(apiUrl);
                items = (response.data.items || []).slice(0, 30);
                if (!items.length) {
                    if (specialBuilder) {
                        const container = new ContainerBuilder().setAccentColor(0x4756ff);
                        specialBuilder(container);
                        return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    }
                    await interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
                    return;
                }
                totalPages = items.length;
                if (specialBuilder) totalPages++;
                setPaginationCache(sid, items, { query, totalPages, specialBuilder }, userId);
            } catch (error) {
                let errMsg = error?.response?.data?.error?.message || error?.message || String(error);
                if (errMsg.includes('API key') || errMsg.includes('invalid') || errMsg.includes('quota')) {
                    await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_unavailable', { engine: 'Google' })}` });
                    return;
                }
                await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_error', { engine: 'Google' })}` });
                return;
            }
        } else {
            if (!query || typeof query !== 'string' || !query.trim()) {
                await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.no_query_provided')}` });
                return;
            }
            try {
                let params;
                if (engineName === 'google') {
                    params = { engine: engineName, q: query, num: 30, safe: 'active', api_key: process.env.SERPAPI_KEY || SERPAPI_KEY };
                } else if (engineName === 'bing') {
                    params = { engine: engineName, q: query, num: 30, safeSearch: 'strict', api_key: process.env.SERPAPI_KEY || SERPAPI_KEY };
                } else if (engineName === 'yahoo') {
                    params = { engine: engineName, p: query, num: 30, vm: 'r', api_key: process.env.SERPAPI_KEY || SERPAPI_KEY };
                } else {
                    params = { engine: engineName, text: query, num: 30, safe: 'active', api_key: process.env.SERPAPI_KEY || SERPAPI_KEY };
                }

                let serpApiError = null;
                await new Promise((resolve) => {
                    getJson(params, async (result, err) => {
                        if (err || (result && result.error && typeof result.error === 'string' && result.error.match(/api key|invalid|quota|unavailable|forbidden|denied|Missing query/i))) {
                            serpApiError = result && result.error ? result.error : (err && err.message ? err.message : 'Unknown error');
                            return resolve();
                        }
                        items = (result && result.organic_results && Array.isArray(result.organic_results)) ? result.organic_results.slice(0, 30) : [];
                        if (!items.length) {
                            if (specialBuilder) {
                                const container = new ContainerBuilder().setAccentColor(0x4756ff);
                                specialBuilder(container);
                                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                            } else {
                                await interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
                            }
                            return resolve();
                        }
                        totalPages = items.length;
                        if (specialBuilder) totalPages++;
                        setPaginationCache(sid, items, { query, totalPages, specialBuilder }, userId);
                        resolve();
                    });
                });
                if (serpApiError) {
                    await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_unavailable_error', { engine: engineName.charAt(0).toUpperCase() + engineName.slice(1), error: serpApiError })}` });
                    return;
                }
                if (!items.length) return;
            } catch (err) {
                await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_unavailable', { engine: engineName.charAt(0).toUpperCase() + engineName.slice(1) })}` });
                return;
            }
        }
    } else {
        const cache = getPaginationCache(sid);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        items = cache.results;
        totalPages = cache.meta.totalPages;
        specialBuilder = cache.meta.specialBuilder;
        await interaction.deferUpdate();
    }
    const currentPage = Math.max(1, Math.min(page, totalPages));
    let res;

    if (specialBuilder) {
        if (page === 1) {
            const container = new ContainerBuilder().setAccentColor(color || 0x4756ff);
            specialBuilder(container);

            const nextId = `search_${engineName}_next_2_${sid}`;
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.prev')).setCustomId(`search_${engineName}_prev_0_${sid}`).setDisabled(true),
                new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(t('common:pagination.next')).setCustomId(nextId).setDisabled(totalPages <= 1)
            );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            if (totalPages === 1) {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - Search`));
            } else {
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Waterfall - ${t('common:pagination.page_of', { current: 1, total: totalPages })}`));
            }
            container.addActionRowComponents(actionRow);

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return;
        }
        res = items[page - 2];
    } else {
        res = items[currentPage - 1];
    }
    let domain, logoUrl;

    if (engineName === 'google') {
        try {
            domain = new URL(res.link).hostname;
            logoUrl = await funcs.getLogoUrl(domain);
        } catch {
            if (!domain) domain = 'google.com';
            logoUrl = '';
        }
    } else {
        try {
            domain = new URL(res.link).hostname;
            logoUrl = await funcs.getLogoUrl(domain);
        } catch {
            if (!domain) domain = engineName + '.com';
            logoUrl = '';
        }
        if (!logoUrl) logoUrl = '';
    }

    const component = await buildSerpApiComponent(res, currentPage, totalPages, engineName, color, emoji, query, logoUrl, domain, profanityDetected, sid, t, specialBuilder);
    await interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
}

async function handleSearchPagination(interaction, t) {
    const id = interaction.customId;
    const ddgMatch = id.match(/^search_ddg_(prev|next)_(\d+)_(.+)$/);
    const serpMatch = id.match(/^search_(google|bing|yahoo|yandex)_(prev|next)_(\d+)_(.+)$/);
    let sessionId, page;
    if (ddgMatch) {
        const [, direction, pageStr, sessionIdRaw] = ddgMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        const safeQuery = cache.meta.query;
        const profanityDetected = false; //ALREADY FILTERED !!
        const specialBuilder = cache.meta.specialBuilder;
        await handleDuckDuckGo(interaction, safeQuery, page, profanityDetected, true, sessionId, t, specialBuilder);
        return;
    } else if (serpMatch) {
        const [, engine, direction, pageStr, sessionIdRaw] = serpMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        const safeQuery = cache.meta.query;
        const profanityDetected = false;
        const specialBuilder = cache.meta.specialBuilder;
        await handleSerpApiEngine(interaction, safeQuery, engine,
            engine === 'google' ? 0x4285F4 : engine === 'bing' ? 0x00809D : engine === 'yahoo' ? 0x720E9E : 0xFF0000,
            engine === 'google' ? e.icon_google : engine === 'bing' ? e.icon_bing : engine === 'yahoo' ? e.icon_yahoo : e.forum,
            page, safeQuery, profanityDetected, true, sessionId, t, specialBuilder
        );
        return;
    }

    const ddgImgMatch = id.match(/^search_ddg_img_(prev|next)_(\d+)_(.+)$/);
    if (ddgImgMatch) {
        const [, direction, pageStr, sessionIdRaw] = ddgImgMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        await handleDDGImages(interaction, cache.meta.query, page, true, sessionId, t);
        return;
    }

    const ddgNewsMatch = id.match(/^search_ddg_news_(prev|next)_(\d+)_(.+)$/);
    if (ddgNewsMatch) {
        const [, direction, pageStr, sessionIdRaw] = ddgNewsMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            await interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        await handleDDGNews(interaction, cache.meta.query, page, true, sessionId, t);
        return;
    }

    const wikiMatch = id.match(/^search_wiki_(prev|next)_(\d+)_(.+)$/);
    if (wikiMatch) {
        const [, direction, pageStr, sessionIdRaw] = wikiMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        await handleWikipedia(interaction, cache.meta.query, page, true, sessionId, t);
        return;
    }

    const soMatch = id.match(/^search_so_(prev|next)_(\d+)_(.+)$/);
    if (soMatch) {
        const [, direction, pageStr, sessionIdRaw] = soMatch;
        sessionId = sessionIdRaw;
        page = Math.max(1, parseInt(pageStr, 10));
        if (isPaginationExpired(sessionId)) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        const cache = getPaginationCache(sessionId);
        if (!cache) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.expired')}`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.user.id !== cache.userId) {
            return interaction.reply({ content: `${e.pixel_cross} ${t('common:pagination.only_user')}`, flags: MessageFlags.Ephemeral });
        }
        await handleStackOverflow(interaction, cache.meta.query, page, true, sessionId, t);
        return;
    }


}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setNameLocalizations(commandMeta.search.name)
        .setDescription('Search the web')
        .setDescriptionLocalizations(commandMeta.search.description)
        .addSubcommand(sub => sub.setName('duckduckgo').setNameLocalizations(commandMeta.search.duckduckgo_name).setDescription('Search DuckDuckGo').setDescriptionLocalizations(commandMeta.search.duckduckgo_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('google').setNameLocalizations(commandMeta.search.google_name).setDescription('Search Google').setDescriptionLocalizations(commandMeta.search.google_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('bing').setNameLocalizations(commandMeta.search.bing_name).setDescription('Search Bing').setDescriptionLocalizations(commandMeta.search.bing_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('yahoo').setNameLocalizations(commandMeta.search.yahoo_name).setDescription('Search Yahoo').setDescriptionLocalizations(commandMeta.search.yahoo_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true).setAutocomplete(true)))
        //.addSubcommand(sub => sub.setName('yandex').setNameLocalizations(commandMeta.search.yandex_name).setDescription('Search Yandex').setDescriptionLocalizations(commandMeta.search.yandex_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true)))
        .addSubcommand(sub => sub.setName('wikipedia').setNameLocalizations(commandMeta.search.wikipedia_name || {}).setDescription('Search Wikipedia').setDescriptionLocalizations(commandMeta.search.wikipedia_description || {}).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('stackoverflow').setNameLocalizations(commandMeta.search.stackoverflow_name || {}).setDescription('Search StackOverflow').setDescriptionLocalizations(commandMeta.search.stackoverflow_description || {}).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true)))
        .addSubcommand(sub => sub.setName('news').setDescription('Search DuckDuckGo News').addStringOption(opt => opt.setName('query').setDescription('News search query').setRequired(true)))
        .addSubcommand(sub => sub.setName('queries').setNameLocalizations(commandMeta.search.queries_name).setDescription('Get links to all search engines').setDescriptionLocalizations(commandMeta.search.queries_description).addStringOption(opt => opt.setName('query').setNameLocalizations(commandMeta.search.option_query_name || {}).setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query_description || {}).setRequired(true))),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        const sub = interaction.options.getSubcommand();
        const query = interaction.options.getString('query');
        if (sub === 'queries') {
            const safeQueryImmediate = await filterQuery(query);
            await handleAllLinks(interaction, safeQueryImmediate, query, t);
            return;
        }
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        const safeQuery = await filterQuery(query);
        const profanityDetected = safeQuery !== query;
        if (sub === 'duckduckgo') {
            await handleDuckDuckGo(interaction, safeQuery, 1, profanityDetected, false, null, t);
        } else if (sub === 'google') {
            await handleSerpApiEngine(interaction, safeQuery, 'google', 0x4285F4, e.icon_google, 1, safeQuery, profanityDetected, false, null, t);
        } else if (sub === 'bing') {
            await handleSerpApiEngine(interaction, safeQuery, 'bing', 0x00809D, e.icon_bing, 1, safeQuery, profanityDetected, false, null, t);
        } else if (sub === 'yahoo') {
            await handleSerpApiEngine(interaction, safeQuery, 'yahoo', 0x720E9E, e.icon_yahoo, 1, safeQuery, profanityDetected, false, null, t);
        } else if (sub === 'yandex') {
            await handleSerpApiEngine(interaction, safeQuery, 'yandex', 0xFF0000, e.forum, 1, safeQuery, profanityDetected, false, null, t);
        } else if (sub === 'wikipedia') {
            await handleWikipedia(interaction, safeQuery, 1, false, null, t);
        } else if (sub === 'stackoverflow') {
            await handleStackOverflow(interaction, safeQuery, 1, false, null, t);
        } else if (sub === 'news') {
            await handleDDGNews(interaction, safeQuery, 1, false, null, t);

        } else {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('<:search:1371166233788940460> Engine not implemented yet.');
            } else {
                await interaction.reply('<:search:1371166233788940460> Engine not implemented yet.');
            }
        }
    },
    help: {
        name: "search",
        description: "Search for information on the internet.",
        category: "General",
        permissions: [],
        botPermissions: [],
        created: 1765271948
    },
    async autocomplete(interaction, bot, settings) {
        try {
            logger.debug('[Autocomplete] Called for command:', interaction.commandName);
            const focusedOption = interaction.options.getFocused(true);
            logger.debug('[Autocomplete] Focused option:', focusedOption);

            if (focusedOption.name === 'query') {
                const query = focusedOption.value;
                logger.debug('[Autocomplete] Query:', query);

                if (!query || query.length < 2) {
                    logger.debug('[Autocomplete] Query too short, returning empty');
                    return await interaction.respond([]);
                }

                try {
                    const sub = interaction.options.getSubcommand();
                    let suggestions = [];

                    if (['duckduckgo', 'google', 'bing', 'yahoo'].includes(sub)) {
                        suggestions = await getDdgAutocomplete(query, interaction.user.id);
                    } else if (sub === 'wikipedia') {
                        suggestions = await getWikipediaAutocomplete(query, interaction.user.id);
                    }

                    logger.debug(`[Autocomplete] Got ${suggestions.length} suggestions for ${sub}`);
                    const choices = suggestions.slice(0, 25).map(s => ({ name: s, value: s }));
                    return await interaction.respond(choices);
                } catch (err) {
                    logger.error('[Autocomplete] Error in getting suggestions:', err);
                    logger.debug('[Autocomplete] Full error details:', err);
                    return await interaction.respond([]);
                }
            } else {
                logger.debug('[Autocomplete] Not a query option, returning empty');
                return await interaction.respond([]);
            }
        } catch (err) {
            logger.error('[Autocomplete] Top-level error:', err);
            try {
                return await interaction.respond([]);
            } catch (respondErr) {
                logger.error('[Autocomplete] Failed to send empty response:', respondErr);
            }
        }
    },
    handleSearchPagination,
    filterQuery
};

// contributors: @relentiousdragon