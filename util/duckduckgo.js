const DDG = require('duck-duck-scrape');
const logger = require('../logger.js');
const axios = require('axios');
//
class DDGQueue {
    constructor() {
        this.queue = [];
        this.activeCount = 0;
        this.callsSinceLastPause = 0;
        this.lastCallTime = 0;
        this.maxConcurrent = 2;
        this.delayBetweenCalls = 2000;
        this.pauseAfterThree = 5000;
        this.processing = false;
    }

    get requestOptions() {
        return {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
    }

    async add(fn, description = 'DDG API call') {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject, description });
            logger.debug(`[DDGQueue] Added to queue: ${description}. Queue size: ${this.queue.length}`);
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            if (this.activeCount >= this.maxConcurrent) {
                logger.debug(`[DDGQueue] Max concurrent reached (${this.activeCount}), waiting...`);
                await this.sleep(100);
                continue;
            }

            if (this.callsSinceLastPause >= 3) {
                logger.debug(`[DDGQueue] Pausing for ${this.pauseAfterThree}ms after 3 calls`);
                await this.sleep(this.pauseAfterThree);
                this.callsSinceLastPause = 0;
            }

            const timeSinceLastCall = Date.now() - this.lastCallTime;
            if (timeSinceLastCall < this.delayBetweenCalls) {
                const waitTime = this.delayBetweenCalls - timeSinceLastCall;
                logger.debug(`[DDGQueue] Waiting ${waitTime}ms before next call`);
                await this.sleep(waitTime);
            }

            const task = this.queue.shift();
            if (!task) continue;

            this.activeCount++;
            this.callsSinceLastPause++;
            this.lastCallTime = Date.now();

            logger.debug(`[DDGQueue] Executing: ${task.description}. Active: ${this.activeCount}`);

            this.executeTask(task);
        }

        this.processing = false;
    }

    async executeTask(task) {
        try {
            const result = await task.fn();
            task.resolve(result);
        } catch (error) {
            logger.error(`[DDGQueue] Error in ${task.description}: ${error.message}`);
            task.reject(error);
        } finally {
            this.activeCount--;
            logger.debug(`[DDGQueue] Completed: ${task.description}. Active: ${this.activeCount}`);
            if (this.queue.length > 0 && !this.processing) {
                this.processQueue();
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const ddgQueue = new DDGQueue();

const DDG_CACHE = new Map();
const DDG_CACHE_TTL = 60 * 60 * 1000;
const DDG_CACHE_MAX_SIZE = 200;

function getCacheKey(type, ...args) {
    return `${type}:${args.join(':')}`.toLowerCase();
}

function getFromCache(key) {
    const entry = DDG_CACHE.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > DDG_CACHE_TTL) {
        DDG_CACHE.delete(key);
        logger.debug(`[DDGCache] Expired: ${key}`);
        return null;
    }

    logger.debug(`[DDGCache] Hit: ${key}`);
    return entry.data;
}

function setCache(key, data) {
    if (DDG_CACHE.size >= DDG_CACHE_MAX_SIZE) {
        const oldestKey = DDG_CACHE.keys().next().value;
        DDG_CACHE.delete(oldestKey);
        logger.debug(`[DDGCache] Evicted oldest: ${oldestKey}`);
    }

    DDG_CACHE.set(key, { data, timestamp: Date.now() });
    logger.debug(`[DDGCache] Set: ${key}`);
}

setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of DDG_CACHE.entries()) {
        if (now - entry.timestamp > DDG_CACHE_TTL) {
            DDG_CACHE.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        logger.debug(`[DDGCache] Cleaned ${cleaned} expired entries`);
    }
}, 5 * 60 * 1000);

async function ddgSearchNews(query, options = {}) {
    const cacheKey = getCacheKey('news', query, JSON.stringify(options));
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.searchNews(query, {
                safeSearch: DDG.SafeSearchType.STRICT,
                ...options
            }, ddgQueue.requestOptions),
            `searchNews: ${query}`
        );

        if (result && !result.noResults) {
            setCache(cacheKey, result);
        }

        logger.debug(`[DDGSearchNews] Query: "${query}" - ${result?.results?.length || 0} results`);
        return result;
    } catch (error) {
        logger.error(`[DDGSearchNews] Failed for "${query}": ${error.message}`);
        throw error;
    }
}

async function ddgForecast(location, locale = 'en') {
    const cacheKey = getCacheKey('forecast', location, locale);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.forecast(location, locale, ddgQueue.requestOptions),
            `forecast: ${location}`
        );

        if (result) {
            setCache(cacheKey, result);
            logger.debug(`[DDGForecast] Location: "${location}" - Found`);
        } else {
            logger.debug(`[DDGForecast] Location: "${location}" - No results`);
        }

        return result;
    } catch (error) {
        logger.error(`[DDGForecast] Failed for "${location}": ${error.message}`);
        throw error;
    }
}

async function ddgStocks(symbol) {
    const cacheKey = getCacheKey('stocks', symbol);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.stocks(symbol.toUpperCase(), ddgQueue.requestOptions),
            `stocks: ${symbol}`
        );

        if (result && result.Last) {
            result.source_api = 'Xignite';
            setCache(cacheKey, result);
            logger.debug(`[DDGStocks] Symbol: "${symbol}" - Price: ${result.Last}`);
            return result;
        }
    } catch (error) {
        logger.debug(`[DDGStocks] standard API failed, trying fallback: ${error.message}`);
    }

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1d`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const result = response.data?.chart?.result?.[0];

        if (result && result.meta) {
            const meta = result.meta;
            const price = meta.regularMarketPrice;
            const prevClose = meta.previousClose;
            const change = price - prevClose;
            const changePercent = (change / prevClose) * 100;

            const stockData = {
                Last: price,
                High: meta.regularMarketDayHigh,
                Low: meta.regularMarketDayLow,
                Volume: meta.regularMarketVolume,
                Open: meta.regularMarketOpen,
                PreviousClose: prevClose,
                ChangeFromPreviousClose: change,
                PercentChangeFromPreviousClose: changePercent,
                Currency: meta.currency,
                High52Weeks: meta.fiftyTwoWeekHigh,
                Low52Weeks: meta.fiftyTwoWeekLow,
                Security: {
                    Name: meta.shortName || meta.longName || symbol.toUpperCase()
                },
                Date: new Date().toLocaleDateString(),
                Time: new Date().toLocaleTimeString(),
                source_api: 'Yahoo Finance',
                Timestamp: Math.floor(Date.now() / 1000)
            };

            setCache(cacheKey, stockData);
            logger.debug(`[DDGStocks] Symbol: "${symbol}" - Price: ${price} (via Yahoo)`);
            return stockData;
        }
    } catch (err) {
        logger.error(`[DDGStocks] Fallback failed for "${symbol}": ${err.message}`);
    }

    return null;
}

async function ddgTime(location) {
    const cacheKey = getCacheKey('time', location);
    const cached = getFromCache(cacheKey);
    if (cached && (Date.now() - DDG_CACHE.get(cacheKey).timestamp < 60000)) {
        return cached;
    }

    try {
        const result = await ddgQueue.add(
            () => DDG.time(location, ddgQueue.requestOptions),
            `time: ${location}`
        );

        if (result && result.locations && result.locations.length > 0) {
            setCache(cacheKey, result);
            logger.debug(`[DDGTime] Location: "${location}" - ${result.locations.length} results`);
        } else {
            logger.debug(`[DDGTime] Location: "${location}" - No results`);
        }

        return result;
    } catch (error) {
        logger.error(`[DDGTime] Failed for "${location}": ${error.message}`);
        throw error;
    }
}

async function ddgCurrency(from, to, amount = 1) {
    const cacheKey = getCacheKey('currency', from, to, amount.toString());
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.currency(from.toUpperCase(), to.toUpperCase(), amount, ddgQueue.requestOptions),
            `currency: ${amount} ${from} to ${to}`
        );

        if (result && result.conversion) {
            setCache(cacheKey, result);
            logger.debug(`[DDGCurrency] ${amount} ${from} to ${to} - Rate: ${result.conversion?.['converted-amount'] || 'N/A'}`);
            return result;
        }
    } catch (error) {
        logger.debug(`[DDGCurrency] standard API failed, trying fallback: ${error.message}`);
    }

    try {
        const fromCode = from.toUpperCase();
        const toCode = to.toUpperCase();
        const url = `https://api.exchangerate-api.com/v4/latest/${fromCode}`;
        const response = await axios.get(url);

        if (response.data && response.data.rates && response.data.rates[toCode]) {
            const rate = response.data.rates[toCode];
            const converted = amount * rate;

            const currencyData = {
                conversion: {
                    'from-currency-symbol': fromCode,
                    'to-currency-symbol': toCode,
                    'from-amount': amount,
                    'converted-amount': converted.toFixed(4),
                    'conversion-rate': rate
                },
                topConversions: [],
                source_api: 'ExchangeRate-API'
            };

            setCache(cacheKey, currencyData);
            logger.debug(`[DDGCurrency] ${amount} ${from} to ${to} - Rate: ${converted} (via ExchangeAPI)`);
            return currencyData;
        }
    } catch (err) {
        logger.error(`[DDGCurrency] Fallback failed for ${from} to ${to}: ${err.message}`);
    }

    return null;
}

function detectQueryType(query) {
    const q = query.toLowerCase().trim();
    const funcs = require('./functions.js');

    const MAX_CURRENCY_AMOUNT = 100e9;

    const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN', 'BRL', 'RUB', 'KRW', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'NZD', 'ZAR', 'TRY', 'PLN', 'THB', 'IDR', 'MYR', 'PHP', 'CZK', 'ILS', 'CLP', 'PKR', 'EGP', 'SAR', 'AED', 'COP', 'ARS', 'VND', 'TWD', 'BDT', 'HUF', 'RON', 'NGN', 'UAH', 'KES', 'PEN'];

    const currencyPatterns = [
        /^([\d,.]+[kmbt]?)\s*([A-Z]{3})\s+(?:to|in|into)\s+([A-Z]{3})$/i,
        /^convert\s+([\d,.]+[kmbt]?)\s*([A-Z]{3})\s+(?:to|in)\s+([A-Z]{3})$/i,
        /^([A-Z]{3})\s+to\s+([A-Z]{3})$/i,
        /^how\s+much\s+is\s+([\d,.]+[kmbt]?)\s*([A-Z]{3})\s+in\s+([A-Z]{3})$/i,
        /^([\d,.]+[kmbt]?)\s+([A-Z]{3})\s*=\s*\?\s*([A-Z]{3})$/i
    ];

    for (const pattern of currencyPatterns) {
        const match = query.match(pattern);
        if (match) {
            let amount, from, to;
            if (match.length === 4) {
                amount = funcs.parseAbbr(match[1]);
                from = match[2].toUpperCase();
                to = match[3].toUpperCase();
            } else if (match.length === 3) {
                amount = 1;
                from = match[1].toUpperCase();
                to = match[2].toUpperCase();
            }

            if (!validCurrencies.includes(from) || !validCurrencies.includes(to)) {
                continue;
            }

            if (amount > MAX_CURRENCY_AMOUNT) {
                logger.debug(`[DetectQuery] Currency too large (>${MAX_CURRENCY_AMOUNT}), falling back to search`);
                continue;
            }

            logger.debug(`[DetectQuery] Currency detected: ${amount} ${from} to ${to}`);
            return { type: 'currency', params: { amount, from, to } };
        }
    }

    const weatherPatterns = [
        /^weather\s+(?:in\s+)?(.+)$/i,
        /^forecast\s+(?:for\s+)?(.+)$/i,
        /^(.+?)\s+weather$/i,
        /^what(?:'s|s|\s+is)\s+the\s+weather\s+(?:in\s+|like\s+in\s+)?(.+)$/i,
        /^is\s+it\s+(?:raining|sunny|cloudy|snowing|hot|cold)\s+in\s+(.+)$/i,
        /^how\s+(?:hot|cold|warm)\s+is\s+it\s+in\s+(.+)$/i,
        /^temperature\s+(?:in\s+)?(.+)$/i,
        /^(.+?)\s+forecast$/i
    ];

    for (const pattern of weatherPatterns) {
        const match = query.match(pattern);
        if (match) {
            const location = match[2] || match[1];
            if (location && location.trim().length > 1) {
                logger.debug(`[DetectQuery] Weather detected: "${location}"`);
                return { type: 'weather', params: { location: location.trim() } };
            }
        }
    }

    const timePatterns = [
        /^(?:what\s+)?time\s+(?:in\s+|at\s+)?(.+)$/i,
        /^what(?:'s|s|\s+is)\s+the\s+time\s+in\s+(.+)$/i,
        /^current\s+time\s+(?:in\s+)?(.+)$/i,
        /^(.+?)\s+time(?:zone)?$/i,
        /^what\s+time\s+is\s+it\s+in\s+(.+)$/i,
        /^(.+?)\s+current\s+time$/i
    ];

    for (const pattern of timePatterns) {
        const match = query.match(pattern);
        if (match) {
            const location = match[2] || match[1];
            if (location && location.trim().length > 1 && !location.match(/^(zone|zones)$/i)) {
                logger.debug(`[DetectQuery] Time detected: "${location}"`);
                return { type: 'time', params: { location: location.trim() } };
            }
        }
    }

    const stockPatterns = [
        /^(?:stock|stocks?)\s+(?:price\s+(?:of|for)\s+)?([A-Za-z\^][A-Za-z0-9\^ .&-]{0,19})$/i,
        /^([A-Za-z\^][A-Za-z0-9\^ .&-]{0,19})\s+(?:stock|stocks?|share|price)$/i,
        /^\$(?:\s*)?([A-Za-z\^][A-Za-z0-9\^ .&-]{0,19})$/i
    ];

    const stockAliases = {
        'DOW JONES': '^DJI',
        'DOW': '^DJI',
        'DJI': '^DJI',
        'S&P 500': '^GSPC',
        'S&P': '^GSPC',
        'SP500': '^GSPC',
        'GSPC': '^GSPC',
        'NASDAQ': '^IXIC',
        'IXIC': '^IXIC',
        'BTC': 'BTC-USD',
        'BITCOIN': 'BTC-USD',
        'ETH': 'ETH-USD',
        'ETHEREUM': 'ETH-USD'
    };

    for (const pattern of stockPatterns) {
        const match = query.match(pattern);
        if (match) {
            let symbol = match[1].trim().toUpperCase();
            if (stockAliases[symbol]) symbol = stockAliases[symbol];

            logger.debug(`[DetectQuery] Stock detected: "${symbol}"`);
            return { type: 'stocks', params: { symbol } };
        }
    }

    const emojipediaPattern = /^(?:(?:what\s+is|what'?s|whats)\s+)?(?:meaning|define|emoji)?\s*(\p{Extended_Pictographic}(?:\p{Emoji_Modifier}?|\u200d\p{Extended_Pictographic})*)\s*(?:meaning|emoji)?\s*$/iu;

    const match = query.match(emojipediaPattern);
    if (match) {
        logger.debug(`[DetectQuery] Emojipedia detected: "${match[1]}"`);
        return { type: 'emojipedia', params: { emoji: match[1] } };
    }

    const containsEmoji = /\p{Extended_Pictographic}/u.test(query);

    const dictionaryPatterns = [
        /^define\s+(.+)$/i,
        /^what\s+(?:does|is)\s+(.+?)\s+mean(?:ing)?(?:\?)?$/i,
        /^(.+?)\s+meaning$/i,
        /^(.+?)\s+definition$/i,
        /^meaning\s+of\s+(.+)$/i,
        /^definition\s+of\s+(.+)$/i,
        /^(.+?)\s+dictionary$/i,
        /^what\s+is\s+the\s+meaning\s+of\s+(.+?)(?:\?)?$/i,
        /^what\s+is\s+the\s+definition\s+of\s+(.+?)(?:\?)?$/i
    ];

    if (!containsEmoji) {
        for (const pattern of dictionaryPatterns) {
            const match = query.match(pattern);
            if (match) {
                const word = match[1].trim();
                if (word && word.split(/\s+/).length <= 3) {
                    logger.debug(`[DetectQuery] Dictionary detected: "${word}"`);
                    return { type: 'dictionary', params: { word } };
                }
            }
        }
    }

    const coinflipPatterns = [
        /^(?:flip|toss)\s*(?:a\s*)?coin$/i,
        /^coin\s*flip$/i,
        /^coinflip$/i,
        /^(?:heads?\s+or\s+tails?|tails?\s+or\s+heads?)$/i,
        /^(?:pick|choose)\s+(?:heads?\s+or\s+tails?|tails?\s+or\s+heads?)$/i
    ];

    for (const pattern of coinflipPatterns) {
        if (query.match(pattern)) {
            logger.debug(`[DetectQuery] Coinflip detected`);
            return { type: 'coinflip', params: {} };
        }
    }

    const expandPatterns = [
        /^(?:unshorten|expand)\s+(https?:\/\/[^\s]+|[^\s]+\.[^\s]+)$/i
    ];

    for (const pattern of expandPatterns) {
        const match = query.match(pattern);
        if (match) {
            logger.debug(`[DetectQuery] Expand URL explicit command detected: "${match[1]}"`);
            return { type: 'expand_url', params: { url: match[1].trim() } };
        }
    }

    if (query.length <= 80) {
        const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'is.gd', 'buff.ly', 'ow.ly', 'bit.do', 'uffy.cc'];
        const domainRegex = new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?(${knownShorteners.join('|').replace(/\./g, '\\.')})\\/\\S+$`, 'i');

        if (query.match(domainRegex)) {
            logger.debug(`[DetectQuery] Known shortener detected: "${query}"`);
            return { type: 'expand_url', params: { url: query.trim() } };
        }

        const genericShortRegex = /^(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-z]{2,}\/(\S+)$/i;
        if (query.match(genericShortRegex) && query.length <= 60) {
            logger.debug(`[DetectQuery] Generic URL pattern detected: "${query}"`);
            return { type: 'expand_url', params: { url: query.trim() } };
        }
    }

    logger.debug(`[DetectQuery] Regular search: "${query}"`);
    return { type: 'search', params: { query } };
}

async function ddgAutocomplete(query) {
    const cacheKey = getCacheKey('autocomplete', query);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.autocomplete(query, undefined, ddgQueue.requestOptions),
            `autocomplete: ${query}`
        );

        if (result && Array.isArray(result)) {
            const suggestions = result.map(r => r.phrase);
            setCache(cacheKey, suggestions);
            // logger.debug(`[DDGAutocomplete] Query: "${query}" - ${suggestions.length} results`);
            return suggestions;
        }
        return [];
    } catch (error) {
        logger.error(`[DDGAutocomplete] Failed for "${query}": ${error.message}`);
        return [];
    }
}

async function ddgExpandUrl(url) {
    const cacheKey = getCacheKey('expand', url);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

    try {
        const result = await ddgQueue.add(
            () => DDG.expandUrl(url, undefined, ddgQueue.requestOptions),
            `expand: ${url}`
        );
        if (result && (result.success || result.resolved_url)) {
            setCache(cacheKey, result);
            return result;
        }
        return result;
    } catch (error) {
        logger.error(`[DDGExpandUrl] Failed for "${url}": ${error.message}`);
        return null;
    }
}

const EMOJI_QUERY = `
    query GetEmoji($slug: Slug!, $lang: Language) {
        emoji_v1(slug: $slug, lang: $lang) {
            ...emojiDetailsResource
        }
    }

    fragment shortCodeResource on Shortcode {
        code
        vendor {
            slug
            title
        }
    }

    fragment emojiResource on Emoji {
        alsoKnownAs
        appleName
        code
        codepointsHex
        currentCldrName
        description
        id
        modifiers
        slug
        shortcodes {
            ...shortCodeResource
        }
        title
    }

    fragment emojiDetailsResource on Emoji {
        ...emojiResource
        components {
            ...emojiResource
        }
        emojiVersion {
            date
            name
            slug
            status
        }
        shortcodes {
            code
            source
            vendor {
                slug
                title
            }
        }
        type
        version {
            date
            description
            name
            slug
            status
        }
    }
`;

async function ddgEmojipedia(emojiChar) {
    const cacheKey = getCacheKey('emojipedia', emojiChar);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    let result = null;
    let slug = null;

    try {
        const emojiDataRepo = require('unicode-emoji-json/data-by-emoji.json');
        const item = emojiDataRepo[emojiChar];
        if (item) {
            slug = item.slug.replace(/_/g, '-');
        } else {
            const url = `https://emojipedia.org/${encodeURIComponent(emojiChar)}`;
            const headRes = await axios.head(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
                },
                maxRedirects: 5,
                timeout: 3000
            }).catch(() => null);

            if (headRes) {
                const finalUrl = headRes.request.res.responseUrl || url;
                slug = finalUrl.split('/').filter(Boolean).pop();
            }
        }

        if (slug) {
            const response = await axios.post('https://emojipedia.org/api/graphql', {
                operationName: "GetEmoji",
                query: EMOJI_QUERY,
                variables: { slug, lang: "EN" }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                    'Referer': 'https://emojipedia.org/',
                    'Origin': 'https://emojipedia.org'
                },
                timeout: 5000
            });

            const emoji = response.data?.data?.emoji_v1;
            if (emoji) {
                const discordShortcodes = (emoji.shortcodes || [])
                    .filter(s => s.vendor.slug === 'discord')
                    .map(s => s.code)
                    .join(', ');

                let description = emoji.description || '';

                if (!description && emoji.components && emoji.components.length > 0) {
                    const baseComponent = emoji.components.find(c => c.description);
                    if (baseComponent) {
                        description = baseComponent.description;
                    }
                }

                result = {
                    title: emoji.title,
                    description: description,
                    url: `https://emojipedia.org/${emoji.slug}`,
                    codepoints: (emoji.codepointsHex || []).join(' '),
                    shortcodes: discordShortcodes,
                    alsoKnownAs: emoji.alsoKnownAs || [],
                    appleName: emoji.appleName || '',
                    emojiVersion: emoji.emojiVersion?.name || ''
                };
            }
        }

        if (!result && item) {
            const pascalName = item.slug.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
            const emojiPkg = await import('emojipedia/data');
            const data = emojiPkg[pascalName];

            if (data) {
                const discordShortcodes = (data.shortcodes || [])
                    .filter(s => s.vendor.slug === 'discord')
                    .map(s => s.code)
                    .join(', ');

                result = {
                    title: data.title,
                    description: data.description || '',
                    url: `https://emojipedia.org/${data.slug}`,
                    codepoints: (data.codepointsHex || []).join(' '),
                    shortcodes: discordShortcodes,
                    alsoKnownAs: data.alsoKnownAs || [],
                    appleName: data.appleName || '',
                    emojiVersion: data.emojiVersion?.name || ''
                };
            }
        }
    } catch (e) {
        logger.error(`[DDGEmojipedia] Lookup failed for "${emojiChar}": ${e.message}`);
    }

    if (result) {
        setCache(cacheKey, result);
        return result;
    }

    return null;
}
//
module.exports = {
    ddgSearchNews,
    ddgForecast,
    ddgStocks,
    ddgTime,
    ddgCurrency,
    detectQueryType,
    ddgAutocomplete,
    ddgExpandUrl,
    ddgEmojipedia,
    SafeSearchType: DDG.SafeSearchType
};


// contributors: @relentiousdragon