require("dotenv").config();
const { MessageFlags, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ConnectionService } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');
const { GOOGLE_API_KEY, GOOGLE_CSE_ID, SERPAPI_KEY, OMDB_API_KEY } = process.env;
const { getJson } = require('serpapi');
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();

async function getLogoUrl(domain) {
    return `https://logo.clearbit.com/${domain}`;
}

async function isImageUrl(url, timeout = 2000) {
    if (!url) return false;
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        if (imageExtensions.some(ext => pathname.endsWith(ext))) return true;
    } catch { }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeoutId);
        let contentType = response.headers.get('content-type');
        if (!contentType) return imageExtensions.some(ext => url.toLowerCase().includes(ext));
        return contentType.startsWith('image/');
    } catch {
        return imageExtensions.some(ext => url.toLowerCase().includes(ext));
    }
}
const PAGINATION_CACHE = new Map();
const PAGINATION_TTL = 10 * 60 * 1000;

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

async function buildDuckDuckGoComponent(result, page, totalPages, bot, query, sessionId, t) {
    let domain, logoUrl;
    try {
        domain = new URL(result.url).hostname;
        logoUrl = await getLogoUrl(domain);
    } catch {
        domain = 'duckduckgo.com';
    }

    if (domain == "duckduckgo.com" || !domain || domain == null || domain == "" || domain == undefined) {
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
            .setAccentColor(0x4756ff)
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

    if (result.isAbstract && page === 1) {
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
        if (result.infobox && page === 1) {
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
                faviconUrl = await getLogoUrl(faviconDomain);
                validFavicon = await isImageUrl(faviconUrl);
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
            .setAccentColor(0x4756ff)
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
            .setAccentColor(0x4756ff)
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

async function buildSerpApiComponent(res, page, totalPages, engineName, color, emoji, query, logoUrl, domain, profanityDetected, sessionId, t) {
    const serpPrevId = `search_${engineName}_prev_${page - 1}_${sessionId}`;
    const serpNextId = `search_${engineName}_next_${page + 1}_${sessionId}`;
    const expired = isPaginationExpired(sessionId);

    //console.debug("Search result data:", JSON.stringify(res, null, 2));

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
                        const isValid = await isImageUrl(img.url);
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
        domainLogoUrl = await getLogoUrl(domain);
        validDomainLogo = await isImageUrl(domainLogoUrl);
        if (!validDomainLogo) domainLogoUrl = null;
    } catch (err) {
        console.log("Failed to get domain logo:", err.message);
    }
    try {
        validDefaultLogo = await isImageUrl(defaultLogo);
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
    if (!profanityDetected && (res.link.includes('wikipedia.org') || domain.includes('wikipedia.org'))) {
        const titleMatch = res.link.match(/wikipedia\.org\/wiki\/([^?#]+)/);
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
        .setAccentColor(color)
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

async function handleDuckDuckGo(interaction, query, page = 1, profanityDetected = false, isPagination = false, sessionId = null, t) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId('ddg', query, userId);
    let results, totalPages;
    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&kp=1&safe=active`;
        const response = await axios.get(apiUrl);
        const data = response.data;
        results = parseDuckDuckGoResults(data, query).slice(0, 30);
        if (profanityDetected && results.length && results[0].isAbstract) {
            results = results.slice(1);
        }
        if (!results.length) {
            return interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
        }
        totalPages = results.length;
        setPaginationCache(sid, results, { query, totalPages }, userId);
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
        await interaction.deferUpdate();
    }
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const component = await buildDuckDuckGoComponent(results[currentPage - 1], currentPage, totalPages, interaction.client, query, sid, t);
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
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(interaction.client.user.displayAvatarURL({ size: 2048 }))
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${t('commands:search.search_queries_title')}`),
                    new TextDisplayBuilder().setContent(links.map(l => `${l.emoji} [${query}](${l.url})`).join('\n'))
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# Waterfall - Search')
        );
    await interaction.reply({ components: [embed], flags: MessageFlags.IsComponentsV2 });
}

async function handleSerpApiEngine(interaction, query, engineName, color, emoji, page = 1, safeQuery = null, profanityDetected = false, isPagination = false, sessionId = null, t) {
    const userId = interaction.user.id;
    const sid = sessionId || makeSessionId(engineName, query, userId);
    let items, totalPages;
    if (!safeQuery) safeQuery = query;
    if (!isPagination) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (engineName === 'google') {
            try {
                const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&safe=active&num=10`;
                const response = await axios.get(apiUrl);
                items = (response.data.items || []).slice(0, 30);
                if (!items.length) {
                    await interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
                    return;
                }
                totalPages = items.length;
                setPaginationCache(sid, items, { query, totalPages }, userId);
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
                } else if (engineName === 'yandex') { //DISABLED!!!!
                    params = { engine: engineName, text: query, num: 30, safe: 'active', api_key: process.env.SERPAPI_KEY || SERPAPI_KEY };
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
                            await interaction.editReply({ content: `${e.not_found} ${t('common:no_results')}` });
                            return resolve();
                        }
                        totalPages = items.length;
                        setPaginationCache(sid, items, { query, totalPages }, userId);
                        resolve();
                    });
                });
                if (serpApiError) {
                    await interaction.editReply({ content: `${e.pixel_cross} ${t('commands:search.search_unavailable_error', { engine: engineName.charAt(0).toUpperCase() + engineName.slice(1), error: serpApiError })}` });
                    return;
                }
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
        await interaction.deferUpdate();
    }
    const currentPage = Math.max(1, Math.min(page, totalPages));
    let res, domain, logoUrl;
    if (engineName === 'google') {
        res = items[currentPage - 1];
        try {
            domain = new URL(res.link).hostname;
            logoUrl = await getLogoUrl(domain);
        } catch {
            domain = 'google.com';
            logoUrl = '';
        }
        const component = await buildSerpApiComponent(res, currentPage, totalPages, engineName, color, emoji, query, logoUrl, domain, profanityDetected, sid, t);
        await interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
        return;
    } else {
        res = items[currentPage - 1];
        try {
            domain = new URL(res.link).hostname;
            logoUrl = await getLogoUrl(domain);
        } catch {
            domain = engineName + '.com';
            logoUrl = null;
        }
        if (!logoUrl) logoUrl = '';
        const component = await buildSerpApiComponent(res, currentPage, totalPages, engineName, color, emoji, query, logoUrl, domain, profanityDetected, sid, t);
        await interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
        return;
    }
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
        await handleDuckDuckGo(interaction, safeQuery, page, profanityDetected, true, sessionId, t);
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
        await handleSerpApiEngine(interaction, safeQuery, engine,
            engine === 'google' ? 0x4285F4 : engine === 'bing' ? 0x00809D : engine === 'yahoo' ? 0x720E9E : 0xFF0000,
            engine === 'google' ? e.icon_google : engine === 'bing' ? e.icon_bing : engine === 'yahoo' ? e.icon_yahoo : e.forum,
            page, safeQuery, profanityDetected, true, sessionId, t
        );
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
        .addSubcommand(sub => sub.setName('duckduckgo').setNameLocalizations(commandMeta.search.duckduckgo_name).setDescription('Search DuckDuckGo').setDescriptionLocalizations(commandMeta.search.duckduckgo_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true)))
        .addSubcommand(sub => sub.setName('google').setNameLocalizations(commandMeta.search.google_name).setDescription('Search Google').setDescriptionLocalizations(commandMeta.search.google_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true)))
        .addSubcommand(sub => sub.setName('bing').setNameLocalizations(commandMeta.search.bing_name).setDescription('Search Bing').setDescriptionLocalizations(commandMeta.search.bing_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true)))
        .addSubcommand(sub => sub.setName('yahoo').setNameLocalizations(commandMeta.search.yahoo_name).setDescription('Search Yahoo').setDescriptionLocalizations(commandMeta.search.yahoo_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true)))
        //.addSubcommand(sub => sub.setName('yandex').setNameLocalizations(commandMeta.search.yandex_name).setDescription('Search Yandex').setDescriptionLocalizations(commandMeta.search.yandex_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true)))
        .addSubcommand(sub => sub.setName('queries').setNameLocalizations(commandMeta.search.queries_name).setDescription('Get links to all search engines').setDescriptionLocalizations(commandMeta.search.queries_description).addStringOption(opt => opt.setName('query').setDescription('Query').setDescriptionLocalizations(commandMeta.search.option_query).setRequired(true))),
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
    handleSearchPagination,
    filterQuery
};