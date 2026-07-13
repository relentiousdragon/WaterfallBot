const axios = require('axios');
const he = require('he');
const logger = require('../logger.js');

const LANGUAGES = [
    { name: 'English', value: 'en' }, { name: 'Spanish', value: 'es' },
    { name: 'French', value: 'fr' }, { name: 'German', value: 'de' },
    { name: 'Italian', value: 'it' }, { name: 'Portuguese', value: 'pt' },
    { name: 'Russian', value: 'ru' }, { name: 'Japanese', value: 'ja' },
    { name: 'Korean', value: 'ko' }, { name: 'Chinese (Simplified)', value: 'zh-CN' },
    { name: 'Chinese (Traditional)', value: 'zh-TW' }, { name: 'Arabic', value: 'ar' },
    { name: 'Hindi', value: 'hi' }, { name: 'Turkish', value: 'tr' },
    { name: 'Dutch', value: 'nl' }, { name: 'Polish', value: 'pl' },
    { name: 'Swedish', value: 'sv' }, { name: 'Danish', value: 'da' },
    { name: 'Norwegian', value: 'no' }, { name: 'Finnish', value: 'fi' },
    { name: 'Greek', value: 'el' }, { name: 'Czech', value: 'cs' },
    { name: 'Romanian', value: 'ro' }, { name: 'Hungarian', value: 'hu' },
    { name: 'Thai', value: 'th' }, { name: 'Vietnamese', value: 'vi' },
    { name: 'Indonesian', value: 'id' }, { name: 'Malay', value: 'ms' },
    { name: 'Ukrainian', value: 'uk' }, { name: 'Hebrew', value: 'he' },
    { name: 'Bengali', value: 'bn' }, { name: 'Tagalog', value: 'tl' },
    { name: 'Latin', value: 'la' },
];

const DISCORD_LOCALE_TO_LANG = {
    'en-US': 'en', 'en-GB': 'en',
    'es-ES': 'es', 'pt-BR': 'pt', 'pt-PT': 'pt',
    'sv-SE': 'sv', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
    'fr': 'fr', 'de': 'de', 'ja': 'ja', 'ko': 'ko',
    'it': 'it', 'ar': 'ar', 'hi': 'hi', 'tr': 'tr',
    'nl': 'nl', 'pl': 'pl', 'da': 'da', 'no': 'no',
    'fi': 'fi', 'el': 'el', 'cs': 'cs', 'ro': 'ro',
    'hu': 'hu', 'th': 'th', 'vi': 'vi', 'id': 'id',
    'ms': 'ms', 'uk': 'uk', 'he': 'he', 'bn': 'bn',
    'tl': 'tl',
};

const VALID_LANG_CODES = new Set(LANGUAGES.map(l => l.value));
//
const LANG_FLAGS = {
    'en': '🇬🇧', 'es': '🇪🇸', 'fr': '🇫🇷', 'de': '🇩🇪',
    'it': '🇮🇹', 'pt': '🇧🇷', 'ru': '🇷🇺', 'ja': '🇯🇵',
    'ko': '🇰🇷', 'zh-CN': '🇨🇳', 'zh-TW': '🇹🇼', 'ar': '🇸🇦',
    'hi': '🇮🇳', 'tr': '🇹🇷', 'nl': '🇳🇱', 'pl': '🇵🇱',
    'sv': '🇸🇪', 'da': '🇩🇰', 'no': '🇳🇴', 'fi': '🇫🇮',
    'el': '🇬🇷', 'cs': '🇨🇿', 'ro': '🇷🇴', 'hu': '🇭🇺',
    'th': '🇹🇭', 'vi': '🇻🇳', 'id': '🇮🇩', 'ms': '🇲🇾',
    'uk': '🇺🇦', 'he': '🇮🇱', 'bn': '🇧🇩', 'tl': '🇵🇭',
    'la': '🏛️',
};

const BIDI_CHARS = '[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]';
const QUOTE_PAT = new RegExp(`^(${BIDI_CHARS}*)(>+)( +|$)`);
const BULLET_PAT = new RegExp(`^(${BIDI_CHARS}*)([*+-])( +)`);
const NUMBER_PAT = new RegExp(`^(${BIDI_CHARS}*)(\\d+\\.)( +)`);
const NT_PAT = new RegExp(`^(${BIDI_CHARS}*)(nt=\\.)`);
const HEADING_PAT = new RegExp(`^(${BIDI_CHARS}*)(#{1,3})( +)`);
const SUBTEXT_PAT = new RegExp(`^(${BIDI_CHARS}*)(-#)( +)`);

const NL_PLACEHOLDER = '\x00NL\x00';

const TRANSLATION_CACHE_SIZE = 500;
const translationCache = new Map();
//
function cacheGet(key) {
    if (!translationCache.has(key)) return undefined;
    const value = translationCache.get(key);
    translationCache.delete(key);
    translationCache.set(key, value);
    return value;
}

function cacheSet(key, value) {
    if (translationCache.size >= TRANSLATION_CACHE_SIZE) {
        const oldestKey = translationCache.keys().next().value;
        translationCache.delete(oldestKey);
    }
    translationCache.set(key, value);
}

function cacheKey(text, sourceLang, targetLang) {
    return `${sourceLang}\u0001${targetLang}\u0001${text}`;
}
//
class ConcurrencyLimiter {
    constructor(max) {
        this.max = max;
        this.active = 0;
        this.queue = [];
    }
    async run(fn) {
        if (this.active >= this.max) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.active++;
        try {
            return await fn();
        } finally {
            this.active--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }
}

const apiLimiter = new ConcurrencyLimiter(5);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTranslationWithRetry(chunkCore, langPair, maxRetries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get('https://api.mymemory.translated.net/get', {
                params: { q: chunkCore, langpair: langPair, de: 'devseige@gmail.com' },
                timeout: 10000,
            });
            const data = response.data;
            const status = Number(data.responseStatus);
            const retryable = status === 429 || status >= 500;
            if (retryable && attempt < maxRetries) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            if (status !== 200) {
                throw new Error(data.responseDetails || `Translation API error (status ${status})`);
            }
            return data;
        } catch (err) {
            lastErr = err;
            const isNetwork = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
                || err.code === 'ENETUNREACH' || err.message.includes('timeout');
            if (!isNetwork && attempt < maxRetries) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
            if (attempt < maxRetries) {
                await sleep(500 * Math.pow(2, attempt));
                continue;
            }
        }
    }
    throw lastErr || new Error('Translation API failed after retries');
}

function hasTranslatableContent(text) {
    if (!text) return false;
    const clean = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (!clean) return false;
    return /[\p{L}\p{N}]/u.test(clean);
}

function addPunctuation(text) {
    if (!text) return { text: '', addedIndices: [] };
    const lines = text.split('\n');
    const addedIndices = [];
    const modifiedLines = lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (!hasTranslatableContent(trimmed)) return line;

        const lastChar = trimmed[trimmed.length - 1];
        if (/[.!?\:]/.test(lastChar)) return line;

        if (/https?:\/\/[^\s<>]+$/i.test(trimmed)) return line;

        if (trimmed.endsWith('`')) return line;

        addedIndices.push(idx);
        return line + ".";
    });
    return { text: modifiedLines.join('\n'), addedIndices };
}

function removePunctuation(translatedText, addedIndices) {
    if (!translatedText) return '';
    const lines = translatedText.split('\n');
    const modifiedLines = lines.map((line, idx) => {
        if (addedIndices.includes(idx)) {
            return line.replace(/\.\s*$/, '');
        }
        return line;
    });
    return modifiedLines.join('\n');
}

function shouldTranslateLinkText(linkText) {
    if (!hasTranslatableContent(linkText)) return false;
    if (/\b[\w-]+\.[a-zA-Z0-9]{2,4}\b/.test(linkText)) return false;
    if (/https?:\/\//.test(linkText)) return false;
    return true;
}


function restorePlaceholderSpacing(original, translated) {
    if (!original || !translated) return translated;
    
    const tagRegex = /<\/?\s*[a-z]\d+\s*\/?>/gi;
    let result = translated;
    
    result = result.replace(tagRegex, (match, offset, fullStr) => {
        const cleanMatch = match.replace(/\s+/g, '').toLowerCase();
        let origIdx = original.toLowerCase().indexOf(cleanMatch);
        if (origIdx === -1) {
            if (cleanMatch.endsWith('/>')) {
                origIdx = original.toLowerCase().indexOf(cleanMatch.replace('/>', '>'));
            } else if (cleanMatch.endsWith('>')) {
                origIdx = original.toLowerCase().indexOf(cleanMatch.replace('>', '/>'));
            }
        }
        
        const isClosing = match.startsWith('</');
        const isSelfClosing = match.endsWith('/>');
        const isOpening = !isClosing && !isSelfClosing;

        const charBefore = offset > 0 ? fullStr[offset - 1] : '';
        const charAfter = (offset + match.length) < fullStr.length ? fullStr[offset + match.length] : '';

        let prefix = '';
        let suffix = '';

        if (origIdx !== -1) {
            let origLength = cleanMatch.length;
            if (original.toLowerCase().slice(origIdx, origIdx + cleanMatch.length) !== cleanMatch) {
                const origMatch = original.slice(origIdx).match(/^<[^>]+>/);
                if (origMatch) {
                    origLength = origMatch[0].length;
                }
            }

            const origHasLeadingWs = origIdx > 0 && /\s/.test(original[origIdx - 1]);
            const origHasTrailingWs = (origIdx + origLength) < original.length && /\s/.test(original[origIdx + origLength]);
            
            const transHasLeadingWs = offset > 0 && /\s/.test(fullStr[offset - 1]);
            const transHasTrailingWs = (offset + match.length) < fullStr.length && /\s/.test(fullStr[offset + match.length]);
            
            if (origHasLeadingWs && !transHasLeadingWs) {
                const origCharBefore = original[origIdx - 1];
                prefix = origCharBefore === '\n' ? '\n' : ' ';
            } else if (!origHasLeadingWs && !transHasLeadingWs && (isOpening || isSelfClosing) && /[a-zA-Z0-9]/.test(charBefore)) {
                prefix = ' ';
            }

            if (origHasTrailingWs && !transHasTrailingWs) {
                const origCharAfter = original[origIdx + origLength];
                suffix = origCharAfter === '\n' ? '\n' : ' ';
            } else if (!origHasTrailingWs && !transHasTrailingWs && (isClosing || isSelfClosing) && /[a-zA-Z0-9]/.test(charAfter)) {
                suffix = ' ';
            }
        } else {
            if ((isOpening || isSelfClosing) && /[a-zA-Z0-9]/.test(charBefore)) {
                prefix = ' ';
            }
            if ((isClosing || isSelfClosing) && /[a-zA-Z0-9]/.test(charAfter)) {
                suffix = ' ';
            }
        }
        
        return prefix + match + suffix;
    });
    
    return result;
}

function extractLinePrefixes(text) {
    if (!text) return { strippedText: '', linePrefixes: [] };
    const lines = text.split('\n');
    const linePrefixes = [];
    const strippedLines = [];

    for (const line of lines) {
        let prefix = '';
        let remaining = line;

        let changed = true;
        while (changed && remaining.length > 0) {
            changed = false;

            const wsMatch = remaining.match(/^[^\S\r\n]+/);
            if (wsMatch) {
                prefix += wsMatch[0];
                remaining = remaining.slice(wsMatch[0].length);
                changed = true;
            }

            const headingMatch = remaining.match(/^(#{1,3})([^\S\r\n]+|$)/);
            if (headingMatch) {
                prefix += headingMatch[0];
                remaining = remaining.slice(headingMatch[0].length);
                changed = true;
                continue;
            }

            const subtextMatch = remaining.match(/^(-#)([^\S\r\n]+|$)/);
            if (subtextMatch) {
                prefix += subtextMatch[0];
                remaining = remaining.slice(subtextMatch[0].length);
                changed = true;
                continue;
            }

            const quoteMatch = remaining.match(/^(>+)([^\S\r\n]+|$)/);
            if (quoteMatch) {
                prefix += quoteMatch[0];
                remaining = remaining.slice(quoteMatch[0].length);
                changed = true;
                continue;
            }

            const bulletMatch = remaining.match(/^([*+-])([^\S\r\n]+)/);
            if (bulletMatch) {
                prefix += bulletMatch[0];
                remaining = remaining.slice(bulletMatch[0].length);
                changed = true;
                continue;
            }

            const numberMatch = remaining.match(/^(\d+\.)([^\S\r\n]+)/);
            if (numberMatch) {
                prefix += numberMatch[0];
                remaining = remaining.slice(numberMatch[0].length);
                changed = true;
                continue;
            }
        }

        linePrefixes.push(prefix);
        strippedLines.push(remaining);
    }

    return { strippedText: strippedLines.join('\n'), linePrefixes };
}

function restoreLinePrefixes(translatedText, linePrefixes) {
    if (!translatedText) return '';
    if (!linePrefixes || linePrefixes.length === 0) return translatedText;
    const lines = translatedText.split('\n');
    const restored = lines.map((line, idx) => {
        const prefix = idx < linePrefixes.length ? linePrefixes[idx] : '';
        return prefix + line;
    });
    return restored.join('\n');
}

function getLanguageName(code) {
    const lang = LANGUAGES.find(l => l.value === code);
    return lang ? lang.name : code;
}

function discordLocaleToLang(locale) {
    if (!locale) return 'en';
    return DISCORD_LOCALE_TO_LANG[locale] || locale.split('-')[0] || 'en';
}


function detectLanguage(text, returnDetailed = false) {
    if (!text) return returnDetailed ? { lang: 'en', score: 0 } : 'en';
    const sample = text.slice(0, 1000);

    let cjk = 0, arabic = 0, hebrew = 0, thai = 0, devanagari = 0, bengali = 0;
    let cyrillic = 0, greek = 0, korean = 0;
    for (const ch of sample) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x3040 && cp <= 0x30FF) cjk++; 
        else if (cp >= 0x4E00 && cp <= 0x9FFF) cjk++; 
        else if (cp >= 0xAC00 && cp <= 0xD7AF) korean++; 
        else if (cp >= 0x0600 && cp <= 0x06FF) arabic++;
        else if (cp >= 0x0590 && cp <= 0x05FF) hebrew++;
        else if (cp >= 0x0E00 && cp <= 0x0E7F) thai++;
        else if (cp >= 0x0900 && cp <= 0x097F) devanagari++;
        else if (cp >= 0x0980 && cp <= 0x09FF) bengali++;
        else if (cp >= 0x0400 && cp <= 0x04FF) cyrillic++;
        else if (cp >= 0x0370 && cp <= 0x03FF) greek++;
    }

    if (korean > 0) return returnDetailed ? { lang: 'ko', score: 100 } : 'ko';
    if (cjk > 0) {
        const isJa = /[\u3040-\u309F\u30A0-\u30FF]/.test(sample);
        const lang = isJa ? 'ja' : 'zh-CN';
        return returnDetailed ? { lang, score: 100 } : lang;
    }
    if (arabic > 0) return returnDetailed ? { lang: 'ar', score: 100 } : 'ar';
    if (hebrew > 0) return returnDetailed ? { lang: 'he', score: 100 } : 'he';
    if (thai > 0) return returnDetailed ? { lang: 'th', score: 100 } : 'th';
    if (devanagari > 0) return returnDetailed ? { lang: 'hi', score: 100 } : 'hi';
    if (bengali > 0) return returnDetailed ? { lang: 'bn', score: 100 } : 'bn';
    if (cyrillic > 0) return returnDetailed ? { lang: 'ru', score: 100 } : 'ru';
    if (greek > 0) return returnDetailed ? { lang: 'el', score: 100 } : 'el';

    const lower = sample.toLowerCase();
    const latinPatterns = [
        { lang: 'de', re: /\b(der|die|das|und|ist|ein|eine|nicht|ich|sie|wir|guten|morgen|danke|bitte|nach|mit|aus|bei|hat|haben|werden|sind|wird|kein|sehr|auch|schon|noch|bis|vom|durch|gegen|ohne|mein|dein|sein|ihr|unser|euer|diesem|dieser|dieses|alles|nichts|immer|vielleicht|warum|weil|wenn|dann|dort|hier|jetzt|heute|gestern|morgen|abend|nacht|jahr|monat|woche|stunde|arbeit|geld|haus|frau|mann|kind|leben|zeit|welt|stadt|land|leute)\b/g },
        { lang: 'nl', re: /\b(het|van|een|dat|niet|ook|maar|als|dan|wat|dit|hallo|dank|welkom|goed|nog|hier|daar|tijd|nooit|altijd|waar|hoe|veel|zijn|heeft|wordt|deze|want|zou|kunnen|moeten|zullen|waren|geen|wel|toch|alles|niets|iets|iemand|niemand|misschien|waarom|omdat|wanneer|huis|werk|stad|wereld|mensen)\b/g },
        { lang: 'fr', re: /\b(le|la|les|des|un|une|du|au|aux|est|sont|pas|que|dans|pour|avec|cette|bonjour|merci|salut|oui|non|je|tu|nous|vous|ils|elles|ces|sur|tres|fait|faire|peut|bien|etre|avoir|ete|peux|veux|doit|vient|trouve|donne|prend|tout|rien|jamais|toujours|pourquoi|parce|quand|comment|maintenant|aujourd|demain|hier|maison|travail|monde|temps|vie|homme|femme|enfant|ami|jour|nuit|mois|annee|ville|pays|gens|tete|bouche|yeux|mon|ton|son|notre|votre|leur|aussi|encore|entre|depuis|sans|chez|vers|sous|contre|pendant|alors|donc|mais|car|comme|plus|moins|ici|ailleurs|dehors|dedans|cela|ceci|ceux|celle|celui|chaque|autre|meme|tel|suis|sommes|etes|avez|avons|ont|sera|serai|seront|site|officiel|creer|compte|serveur|bienvenue)\b/g },
        { lang: 'es', re: /\b(hola|los|las|una|son|que|para|con|por|gracias|buenos|tambien|pero|como|usted|este|esta|muy|solo|todo|bien|casa|mas|entre|sin|sobre|tiene|puede|dice|hace|tengo|tiempo|hombre|mujer|nino|noche|dia|ano|nuevo|viejo|siempre|nunca|aqui|ahi|donde|cuando|saber|poder|deber|querer|decir|hacer|ver|dar|haber|estar|ser|tener|boca|calle|gente|mundo|vida|amor|ojos|mano|cabeza|cuerpo|agua|comida|trabajo|dinero|ciudad|pais|nada|algo|alguien|nadie|todavia|ahora|entonces|despues|antes|porque|como|asi|verdad|mentira|bueno|malo|grande|pequeno|mejor|peor|mismo|otro|otra|cada|mucho|poco|bastante|demasiado|callate|calla)\b/g },
        { lang: 'it', re: /\b(il|la|le|di|che|non|per|con|una|sono|questo|come|buongiorno|grazie|anche|ma|piu|gli|dei|delle|della|nella|sulla|dello|degli|hanno|essere|avere|questi|quello|quella|molto|poco|troppo|tanto|ancora|dopo|prima|sempre|mai|spesso|forse|dove|quando|perche|cui|chi|cosa|sopra|sotto|dentro|fuori|vicino|lontano|insieme|contro|senza|tutto|niente|qualcuno|nessuno|bocca|testa|occhi|mano|corpo|acqua|cibo|lavoro|soldi|mondo|vida|amore|gente|citta|paese|adesso|oggi|domani|ieri|bene|male|grande|piccolo|stai|zitto|zitti|basta)\b/g },
        { lang: 'pt', re: /\b(os|as|um|uma|nao|que|para|com|por|mais|este|ola|obrigado|obrigada|tambem|mas|bom|boa|voce|ele|ela|eles|elas|nosso|nossa|dela|deles|muito|muita|pouco|sobre|entre|ainda|coisa|tempo|homem|mulher|pessoa|vida|amor|medo|alegria|trabalho|dinheiro|casa|familia|amigo|amiga|dia|noite|ano|mes|semana|hora|lugar|pais|cidade|boca|cala|cale|calado|calada|fala|falar|olha|olhar|aqui|ali|agora|hoje|ontem|amanha|sempre|nunca|tudo|nada|algo|alguem|ninguem|todo|toda|todos|todas|meu|minha|seu|sua|nos|tem|sao|esta|esse|essa|isso|isto|aquilo|pode|deve|quer|sabe|faz|vai|vem|dar|ter|ser|estar|fazer|poder|dizer|ver|ir|sim|porque|onde|quando|como|bem|mal|grande|pequeno|melhor|pior|mesmo|outro|outra|cada|pouco|bastante|demais|gente|mundo|agua|comida|olhos|cabeca|corpo|mao|rua|verdade|mentira|bonito|bonita|feio|feia|certo|errado|novo|velho|alto|baixo|gordo|magro|forte|fraco|rapido|devagar|perto|longe|dentro|fora|acima|abaixo|depois|antes|entao|assim|tambem|talvez|claro|ja|meio|ate|desde|ainda|apenas|quase|realmente|certamente|provavelmente|infelizmente|felizmente|especialmente|principalmente|exatamente|absolutamente|completamente|simplesmente|geralmente|normalmente|rapidamente|lentamente|facilmente|dificilmente)\b/g },
        { lang: 'sv', re: /\b(och|att|det|som|for|med|den|har|inte|var|kan|fran|hej|tack|jag|du|vi|ar|ett|till|men|nar|bara|ocksa|vad|manga|skulle|kunna|val|mycket|lite|stor|liten|bra|lang|kort|hog|ny|gammal|ung|varm|kall|snabb|vacker|rik|stark|rolig|viktig|vanlig|enkel)\b/g },
        { lang: 'no', re: /\b(og|at|er|ikke|for|med|den|har|som|var|kan|fra|hei|takk|jeg|du|vi|til|men|nar|her|bare|ogsa|hva|mange|skulle|kunne|vaere|blitt|gjore|ha|si|ville|skal|vaert|gjort|hatt|sagt|kunnet|matte|burde)\b/g },
        { lang: 'pl', re: /\b(ja|nie|tak|jest|sie|to|co|jak|ale|czy|ten|tego|czesc|dziekuje|bardzo|tylko|mam|masz|ma|mamy|macie|maja|robic|zrobic|mowic|powiedziec|widziec|zobaczyc|slyszec|chciec|wiedziec|umiec|potrafic|musiec|mozna|trzeba|warto|wolno|moze|chyba|pewnie|oczywiscie|naprawde|rzeczywiscie)\b/g },
        { lang: 'hu', re: /\b(nem|igen|egy|az|ez|van|meg|mint|es|de|hogy|ezt|nagyon|szia|koszonom|aki|ami|mert|vagy|volt|lesz|tud|kell|lehet|minden|sem|is|csak|majd|pedig|tehat|ugy|igy|ott|itt|most|akkor|mindig|soha|gyakran|ritkan|neha|mar)\b/g },
        { lang: 'tr', re: /\b(bir|ve|bu|da|icin|ile|ama|olan|cok|daha|her|merhaba|tesekkur|evet|hayir|olarak|yapmak|gibi|kadar|sonra|once|uzere|dolayi|karsi|icer|disar|alt|ust|yan|orta|bas|son|uzun|kisa|buyuk|kucuk|iyi|kotu|guzel|zengin|guclu|komik|onemli|basit)\b/g },
        { lang: 'da', re: /\b(og|at|er|ikke|for|med|den|har|som|var|kan|fra|til|hej|tak|jeg|du|vi|vaere|blive|gore|have|sige|vil|skal|men|nar|her|meget|lidt|stor|lille|god|lang|kort|ny|gammel|ung|varm|kold|hurtig|smuk|rig|stærk|sjov|viktig|almindelig|enkel)\b/g },
        { lang: 'fi', re: /\b(ja|on|se|ei|etta|tai|mutta|hei|kiitos|hyva|olla|tama|han|me|te|he|voi|pitaa|saada|tehda|tieta|koska|kun|vain|jotta|silla|siksi|vaikka|jos|kunnes|niin|nain|siten|sina|tassa|tuossa|siina|tasta|tuosta|siita)\b/g },
    ];

    let bestLang = 'en';
    let bestScore = 0;

    for (const { lang, re } of latinPatterns) {
        const matches = lower.match(re);
        if (matches) {
            const score = new Set(matches).size;
            if (score > bestScore) {
                bestScore = score;
                bestLang = lang;
            }
        }
    }


    const wordCount = sample.trim().split(/\s+/).length;
    const minScore = wordCount <= 5 ? 1 : 2;
    
    let resultLang = bestLang;
    let finalScore = bestScore;
    if (bestScore < minScore) {
        resultLang = 'en';
        finalScore = 0;
    }

    if (returnDetailed) {
        return { lang: resultLang, score: finalScore };
    }
    return resultLang;
}


function isEmojiCodePoint(cp) {
    if (!cp) return false;
    return (
        (cp >= 0x1F300 && cp <= 0x1F9FF) ||  
        (cp >= 0x1FA00 && cp <= 0x1FBFF) ||  
        (cp >= 0x1F000 && cp <= 0x1F0FF) || 
        (cp >= 0x1F100 && cp <= 0x1F2FF) || 
        (cp >= 0x2600 && cp <= 0x27BF) ||
        (cp >= 0x2300 && cp <= 0x23FF) ||
        (cp >= 0x2B00 && cp <= 0x2BFF) ||
        (cp >= 0x2934 && cp <= 0x2935) || 
        (cp >= 0x25AA && cp <= 0x25FE) || 
        (cp >= 0x3030 && cp <= 0x303D) ||    
        (cp >= 0x3297 && cp <= 0x3299) ||    
        (cp >= 0x1F600 && cp <= 0x1F64F) ||  
        (cp >= 0x1F680 && cp <= 0x1F6FF) ||  
        (cp >= 0x1F1E0 && cp <= 0x1F1FF) || 
        cp === 0x2139 ||   
        cp === 0x2328 ||   
        cp === 0x23CF ||  
        cp === 0x24C2 ||   
        cp === 0x200D ||   
        (cp >= 0xFE00 && cp <= 0xFE0F)  
    );
}

const CODE_LANG_TAGS = new Set([
    'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx',
    'python', 'py', 'java', 'kotlin', 'kt', 'scala',
    'c++', 'cpp', 'c', 'c#', 'cs', 'rust', 'rs', 'go',
    'ruby', 'rb', 'php', 'perl', 'pl', 'lua',
    'swift', 'dart', 'elixir', 'haskell', 'hs',
    'html', 'css', 'scss', 'less',
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg',
    'sql', 'bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1',
    'dockerfile', 'makefile', 'gradle', 'cmake',
    'diff', 'patch', 'log',
    'apache', 'nginx', 'docker', 'env', 'gitignore',
]);

const SHORT_CODE_LANG_RE = /^(c|h|js|ts|py|rb|go|rs|kt|sh|pl|hs|lua|r|m|mm)$/i;

function isProbablyTextContent(content) {
    if (!content || !content.trim()) return false;
    const lines = content.split('\n');

    const firstLine = lines[0].trim().toLowerCase();
    if (firstLine) {
        if (CODE_LANG_TAGS.has(firstLine)) return false;
        if (SHORT_CODE_LANG_RE.test(firstLine)) return false;
    }

    const codeLines = firstLine && lines.length > 1 ? lines.slice(1) : lines;
    let codeScore = 0;
    let totalNonEmpty = 0;

    for (const line of codeLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        totalNonEmpty++;

        if (/[{}();]/.test(trimmed)) codeScore += 2;
        if (/^(function|def|class|import|export|const|let|var|if|for|while|return|switch|case|break|continue|try|catch|throw|async|await|yield|from|require|module|interface|type|enum|extends|implements|new|this|super|static|private|public|protected|using|namespace|include|trait|impl|struct|enum|match|fn|let|mut|pub|use|mod|where|select|from|where|join|group|order|limit|insert|update|delete|create|alter|drop|grant|revoke)\b/i.test(trimmed)) codeScore += 3;
        if (/=>|->|::|===|!==|[|]{2}|&&/.test(trimmed)) codeScore += 2;
        if (/\b[a-z_]{2,}\(/i.test(trimmed)) codeScore += 2;
        if (/\/\/|#|<!--|;;/.test(trimmed)) codeScore += 1;
        if (/['"`]/.test(trimmed)) codeScore += 1;
        if (/^\d+[\.\s]/.test(trimmed) || /\d+[xX]/.test(trimmed)) codeScore += 1;
    }


    if (totalNonEmpty === 0) return false;


    const avgScore = codeScore / totalNonEmpty;
    return avgScore < 3.0;
}

function appendToLastTextSegment(segments, texts, content) {
    const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
    if (lastSeg && lastSeg.type === 'text') {
        texts[lastSeg.textIdx] += content;
    } else {
        const textIdx = texts.length;
        texts.push(content);
        segments.push({ type: 'text', textIdx });
    }
}

function parseFormattingSegments(text) {
    const segments = [];
    const texts = [];
    let i = 0;

    while (i < text.length) {
        const remaining = text.slice(i);


        if (remaining.startsWith('```')) {
            const end = remaining.indexOf('```', 3);
            const fullBlock = end === -1 ? remaining : remaining.slice(0, end + 3);
            const innerContent = end === -1 ? remaining.slice(3) : remaining.slice(3, end);

            if (isProbablyTextContent(innerContent) && hasTranslatableContent(innerContent)) {
                const textIdx = texts.length;
                texts.push(innerContent);
                segments.push({ type: 'wrapped', prefix: '```', textIdx, suffix: '```' });
            } else {

                segments.push({ type: 'literal', content: fullBlock });
            }

            i += end === -1 ? remaining.length : end + 3;
            continue;
        }


        if (text[i] === '`') {
            const end = remaining.indexOf('`', 1);
            const innerContent = end === -1 ? remaining.slice(1) : remaining.slice(1, end);
            if (isProbablyTextContent(innerContent) && hasTranslatableContent(innerContent)) {
                const fullContent = '`' + innerContent + '`';
                appendToLastTextSegment(segments, texts, fullContent);
            } else {
                segments.push({ type: 'literal', content: end === -1 ? remaining : remaining.slice(0, end + 1) });
            }
            i += end === -1 ? remaining.length : end + 1;
            continue;
        }

        if (text[i] === '<') {
            let match = null;
            const discordPatterns = [
                /^<t:\d+[^>]*>/,
                /^<@&?\d+>/,
                /^<#\d+>/,
                /^<a?:\w+:\d+>/,
            ];
            for (const pat of discordPatterns) {
                match = remaining.match(pat);
                if (match) break;
            }
            if (match) {
                segments.push({ type: 'literal', content: match[0] });
                i += match[0].length;
                continue;
            }
            //
        }

        if (remaining.startsWith('http')) {
            const match = remaining.match(/^https?:\/\/[^\s<>]+/);
            if (match) {
                segments.push({ type: 'literal', content: match[0] });
                i += match[0].length;
                continue;
            }
        }

        const cp = text.codePointAt(i);
        if (isEmojiCodePoint(cp)) {
            let emojiStr = String.fromCodePoint(cp);
            i += cp >= 0x10000 ? 2 : 1;
            while (i < text.length) {
                const next = text.codePointAt(i);
                if ((next >= 0xFE00 && next <= 0xFE0F) || next === 0x200D || (next >= 0x1F300 && next <= 0x1F9FF)) {
                    emojiStr += String.fromCodePoint(next);
                    i += next >= 0x10000 ? 2 : 1;
                } else {
                    break;
                }
            }
            segments.push({ type: 'literal', content: emojiStr });
            continue;
        }


        if (text[i] === '[') {
            const closeBracket = remaining.indexOf(']');
            if (closeBracket !== -1 && remaining[closeBracket + 1] === '(') {
                const closeParen = remaining.indexOf(')', closeBracket + 2);
                if (closeParen !== -1) {
                    const linkText = remaining.slice(1, closeBracket);
                    const url = remaining.slice(closeBracket + 2, closeParen);
                    if (shouldTranslateLinkText(linkText)) {
                        const textIdx = texts.length;
                        texts.push(linkText);
                        segments.push({ type: 'wrapped', prefix: '[', textIdx, suffix: `](${url})` });
                    } else {
                        segments.push({ type: 'literal', content: `[${linkText}](${url})` });
                    }
                    i += closeParen + 1;
                    continue;
                }
            }
            //
        }

        if (remaining.startsWith('**')) {
            const end = remaining.indexOf('**', 2);
            if (end !== -1 && end > 2) {
                const inner = remaining.slice(2, end);
                const textIdx = texts.length;
                texts.push(inner);
                segments.push({ type: 'wrapped', prefix: '**', textIdx, suffix: '**' });
                i += end + 2;
                continue;
            }
            //
        }

        if (remaining.startsWith('||')) {
            const end = remaining.indexOf('||', 2);
            if (end !== -1 && end > 2) {
                const inner = remaining.slice(2, end);
                const textIdx = texts.length;
                texts.push(inner);
                segments.push({ type: 'wrapped', prefix: '||', textIdx, suffix: '||' });
                i += end + 2;
                continue;
            }
        }

        if (remaining.startsWith('~~')) {
            const end = remaining.indexOf('~~', 2);
            if (end !== -1 && end > 2) {
                const inner = remaining.slice(2, end);
                const textIdx = texts.length;
                texts.push(inner);
                segments.push({ type: 'wrapped', prefix: '~~', textIdx, suffix: '~~' });
                i += end + 2;
                continue;
            }
        }

        if (remaining.startsWith('__')) {
            const end = remaining.indexOf('__', 2);
            if (end !== -1 && end > 2) {
                const inner = remaining.slice(2, end);
                const textIdx = texts.length;
                texts.push(inner);
                segments.push({ type: 'wrapped', prefix: '__', textIdx, suffix: '__' });
                i += end + 2;
                continue;
            }
        }

        if (i === 0 || text[i - 1] === '\n') {
            const matchNt = remaining.match(NT_PAT);
            if (matchNt) {
                const lineEnd = remaining.indexOf('\n');
                const line = lineEnd === -1 ? remaining : remaining.slice(0, lineEnd);
                segments.push({ type: 'literal', content: line });
                i += line.length;
                continue;
            }

            const matchHeading = remaining.match(HEADING_PAT);
            if (matchHeading) {
                segments.push({ type: 'literal', content: matchHeading[0] });
                i += matchHeading[0].length;
                continue;
            }

            const matchSubtext = remaining.match(SUBTEXT_PAT);
            if (matchSubtext) {
                segments.push({ type: 'literal', content: matchSubtext[0] });
                i += matchSubtext[0].length;
                continue;
            }

            const matchQuote = remaining.match(QUOTE_PAT);
            if (matchQuote) {
                segments.push({ type: 'literal', content: matchQuote[0] });
                i += matchQuote[0].length;
                continue;
            }

            const matchBullet = remaining.match(BULLET_PAT);
            if (matchBullet) {
                segments.push({ type: 'literal', content: matchBullet[0] });
                i += matchBullet[0].length;
                continue;
            }

            const matchNumber = remaining.match(NUMBER_PAT);
            if (matchNumber) {
                segments.push({ type: 'literal', content: matchNumber[0] });
                i += matchNumber[0].length;
                continue;
            }
        }

        if (text[i] === '*' && text[i + 1] !== '*') {
            let searchPos = i + 1;
            let closingPos = -1;
            while (searchPos < text.length) {
                const nextStar = text.indexOf('*', searchPos);
                if (nextStar === -1) break;

                if (text[nextStar + 1] === '*') {
                    const boldClose = text.indexOf('**', nextStar + 2);
                    if (boldClose !== -1) {
                        searchPos = boldClose + 2;
                    } else {
                        searchPos = nextStar + 2;
                    }
                    continue;
                }

                closingPos = nextStar;
                break;
            }

            if (closingPos !== -1 && closingPos > i + 1) {
                const inner = remaining.slice(1, closingPos - i);
                const textIdx = texts.length;
                texts.push(inner);
                segments.push({ type: 'wrapped', prefix: '*', textIdx, suffix: '*' });
                i = closingPos + 1;
                continue;
            }
        }

        let nextPos = text.length;
        const searchFrom = i + 1;

        const starters = ['```', '`', '<', 'http', '[', '**', '||', '~~', '__', 'nt=.'];
        for (const starter of starters) {
            const idx = text.indexOf(starter, searchFrom);
            if (idx !== -1 && idx < nextPos) nextPos = idx;
        }

        for (let j = searchFrom; j < text.length; j++) {
            if (text[j] === '\n') {
                const afterNL = j + 1;
                if (afterNL < text.length) {
                    const remAfterNL = text.slice(afterNL, afterNL + 20);
                    if (QUOTE_PAT.test(remAfterNL) || BULLET_PAT.test(remAfterNL) || NUMBER_PAT.test(remAfterNL) || NT_PAT.test(remAfterNL) || HEADING_PAT.test(remAfterNL) || SUBTEXT_PAT.test(remAfterNL)) {
                        if (afterNL < nextPos) {
                            nextPos = afterNL;
                        }
                    }
                }
            }
        }

        for (let j = searchFrom; j < Math.min(text.length, i + 500); ) {
            const emojiCp = text.codePointAt(j);
            if (emojiCp && isEmojiCodePoint(emojiCp)) {
                if (j < nextPos) nextPos = j;
                break;
            }
            j += emojiCp >= 0x10000 ? 2 : 1;
        }

        const starIdx = text.indexOf('*', searchFrom);
        if (starIdx !== -1 && starIdx < nextPos) {
            if (text[starIdx + 1] !== '*') nextPos = starIdx;
        }

        const plainLen = Math.max(1, nextPos - i);
        const plainText = text.slice(i, i + plainLen);


        appendToLastTextSegment(segments, texts, plainText);
        i += plainLen;
    }

    return { segments, texts };
}

function reconstructFromSegments(segments, translatedTexts) {
    let result = '';
    for (const seg of segments) {
        let content = '';
        if (seg.type === 'literal') {
            content = seg.content;
        } else if (seg.type === 'wrapped') {
            content = seg.prefix + translatedTexts[seg.textIdx] + seg.suffix;
        } else if (seg.type === 'text') {
            content = translatedTexts[seg.textIdx];
        }

        if (result && content) {
            const lastChar = result[result.length - 1];
            const firstChar = content[0];
            if (/\w/.test(lastChar) && /[\w*~_`\[]/.test(firstChar)) {
                result += ' ';
            }
        }
        result += content;
    }
    return result;
}

function chunkText(text, maxLen = 450) {
    if (text.length <= maxLen) return [text];
    const chunks = [];

    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + maxLen, text.length);
        if (end >= text.length) {
            chunks.push(text.slice(start));
            break;
        }

        let breakAt = -1;
        const halfwayPoint = start + Math.floor(maxLen / 2);

        for (let j = end; j > halfwayPoint; j--) {
            if (text.slice(j, j + NL_PLACEHOLDER.length) === NL_PLACEHOLDER) { breakAt = j + NL_PLACEHOLDER.length; break; }
        }
        if (breakAt === -1) {
            for (let j = end; j > halfwayPoint; j--) {
                if (text[j] === ' ') { breakAt = j + 1; break; }
            }
        }
        if (breakAt === -1) {
            breakAt = end;
        }

        chunks.push(text.slice(start, breakAt));
        start = breakAt;
    }
    return chunks;
}


async function translateText(text, sourceLang, targetLang) {
    if (!text || !text.trim()) return { translated: text || '', detectedSource: sourceLang || 'auto' };

    let resolvedSource = 'auto';
    let localScore = 0;
    if (!sourceLang || sourceLang === 'auto') {
        const detail = detectLanguage(text, true);
        resolvedSource = detail.lang;
        localScore = detail.score;
    } else {
        resolvedSource = sourceLang;
        localScore = 100; 
    }
    let detectedSource = resolvedSource;

    const useApiAutodetect = (resolvedSource === 'en' && localScore === 0 && (!sourceLang || sourceLang === 'auto'));
    if (useApiAutodetect) {
        resolvedSource = 'autodetect';
    }


    if (resolvedSource === targetLang) {
        return { translated: text, detectedSource, quality: null, reference: null };
    }

    const normalizedText = text.replace(/\r\n/g, '\n');
    const lines = normalizedText.split('\n');
    const processedLines = [];
    const translationPromises = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        const { strippedText, linePrefixes } = extractLinePrefixes(line);
        const prefix = linePrefixes[0] || '';
        
        if (!hasTranslatableContent(strippedText)) {
            processedLines.push({ type: 'static', content: line });
            continue;
        }
        
        let addedPeriod = false;
        let lineToTranslate = strippedText;
        const trimmed = strippedText.trim();
        const lastChar = trimmed[trimmed.length - 1];
        if (!/[.!?\:]/.test(lastChar) && !/https?:\/\/[^\s<>]+$/i.test(trimmed) && !trimmed.endsWith('`')) {
            lineToTranslate = strippedText + ".";
            addedPeriod = true;
        }
        
        const { segments, texts } = parseFormattingSegments(lineToTranslate);
        
        if (texts.length === 0 || texts.every(t => !t.trim())) {
            processedLines.push({ type: 'static', content: line });
            continue;
        }
        
        let placeholderStr = '';
        const literalsTable = [];
        const wrappedTable = [];

        for (const seg of segments) {
            if (seg.type === 'literal') {
                const idx = literalsTable.length;
                literalsTable.push(seg.content);
                placeholderStr += `<r${idx}/>`;
            } else if (seg.type === 'wrapped') {
                const idx = wrappedTable.length;
                wrappedTable.push({ prefix: seg.prefix, suffix: seg.suffix });
                
                let typeChar = 'w';
                if (seg.prefix === '**') typeChar = 'b';
                else if (seg.prefix === '*') typeChar = 'i';
                else if (seg.prefix === '__') typeChar = 'u';
                else if (seg.prefix === '~~') typeChar = 's';
                else if (seg.prefix === '||') typeChar = 'p';
                else if (seg.prefix === '`') typeChar = 'c';
                else if (seg.prefix === '[') typeChar = 'l';

                placeholderStr += `<${typeChar}${idx}>${texts[seg.textIdx]}</${typeChar}${idx}>`;
            } else if (seg.type === 'text') {
                placeholderStr += texts[seg.textIdx];
            }
        }
        
        const promiseIdx = translationPromises.length;
        translationPromises.push((async () => {
            const { translatedTexts, quality, reference, detectedSource: apiDetectedSource } = 
                await batchTranslateSimpleTexts([placeholderStr], resolvedSource, targetLang);
            
            let translated = translatedTexts[0] || placeholderStr;
            
            translated = translated.replace(/<\s*([biuspclw])(\d+)\s*>\s+/gi, (match, char, idx) => {
                return ' <' + char.toLowerCase() + idx + '>';
            });
            translated = translated.replace(/\s+<\s*\/\s*([biuspclw])(\d+)\s*>/gi, (match, char, idx) => {
                return '</' + char.toLowerCase() + idx + '> ';
            });
            
            translated = translated.replace(/<\s*([biuspclw])(\d+)\s*>/gi, '<$1$2>');
            translated = translated.replace(/<\s*\/\s*([biuspclw])(\d+)\s*>/gi, '</$1$2>');
            translated = translated.replace(/<\s*r(\d+)\s*\/*\s*>/gi, '<r$1/>');
            
            translated = restorePlaceholderSpacing(placeholderStr, translated);
            
            translated = translated.replace(/([a-zA-Z0-9])(<\s*[biuspclw]\d+\s*>)/gi, '$1 $2');
            translated = translated.replace(/(<\s*\/\s*[biuspclw]\d+\s*>)([a-zA-Z0-9])/gi, '$1 $2');
            
            translated = postProcessTranslation(translated);

            translated = translated.replace(/<\s*([biuspclw])(\d+)\s*>/gi, (match, char, idx) => {
                const info = wrappedTable[Number(idx)];
                return info ? info.prefix : match;
            });

            translated = translated.replace(/<\s*\/\s*([biuspclw])(\d+)\s*>/gi, (match, char, idx) => {
                const info = wrappedTable[Number(idx)];
                return info ? info.suffix : match;
            });

            translated = translated.replace(/<\s*r(\d+)\s*\/>/gi, (match, idx) => {
                const val = literalsTable[Number(idx)];
                return val !== undefined ? val : match;
            });
            translated = translated.replace(/<\s*r(\d+)\s*>\s*<\s*\/\s*r\1\s*>/gi, (match, idx) => {
                const val = literalsTable[Number(idx)];
                return val !== undefined ? val : match;
            });
            
            if (addedPeriod) {
                translated = translated.replace(/\.\s*$/, '');
            }
            
            return {
                translated: prefix + translated,
                quality,
                reference,
                apiDetectedSource
            };
        })());
        
        processedLines.push({ type: 'translated', promiseIdx });
    }
    
    const results = await Promise.all(translationPromises);
    
    const finalLines = [];
    let totalQuality = 0;
    let qualityCount = 0;
    let firstReference = null;
    
    for (const lineObj of processedLines) {
        if (lineObj.type === 'static') {
            finalLines.push(lineObj.content);
        } else {
            const res = results[lineObj.promiseIdx];
            finalLines.push(res.translated);
            if (res.quality != null) {
                totalQuality += res.quality;
                qualityCount++;
            }
            if (firstReference == null && res.reference) {
                firstReference = res.reference;
            }
            if (res.apiDetectedSource) {
                detectedSource = res.apiDetectedSource;
            }
        }
    }
    
    const finalResult = finalLines.join('\n');
    const quality = qualityCount > 0 ? Math.round(totalQuality / qualityCount) : null;
    
    return { translated: finalResult, detectedSource, quality, reference: firstReference };
}

async function batchTranslateSimpleTexts(texts, sourceLang, targetLang) {
    const translatedTexts = [];
    let totalQuality = 0;
    let qualityCount = 0;
    let firstReference = null;
    let apiDetectedSource = null;

    for (let ti = 0; ti < texts.length; ti++) {
        const text = texts[ti];
        if (!hasTranslatableContent(text)) {
            translatedTexts.push(text);
            continue;
        }

        try {
            const leadingMatch = text.match(/^\s+/);
            const trailingMatch = text.match(/\s+$/);
            const leadingWs = leadingMatch ? leadingMatch[0] : '';
            const trailingWs = trailingMatch ? trailingMatch[0] : '';

            const coreStart = leadingWs.length;
            const coreEnd = trailingWs.length > 0 ? text.length - trailingWs.length : text.length;
            const coreText = text.slice(coreStart, coreEnd);

            const cleanCoreText = coreText.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');

            if (!cleanCoreText || !hasTranslatableContent(cleanCoreText)) {
                translatedTexts.push(text);
                continue;
            }


            const coreTextForApi = coreText.replace(/\n/g, NL_PLACEHOLDER);

            const chunks = chunkText(coreTextForApi);
            const translatedChunks = [];

            for (const chunk of chunks) {
                const chunkLeadingMatch = chunk.match(/^[\s\n]+/);
                const chunkTrailingMatch = chunk.match(/[\s\n]+$/);
                const chunkLeadingWs = chunkLeadingMatch ? chunkLeadingMatch[0] : '';
                const chunkTrailingWs = chunkTrailingMatch ? chunkTrailingMatch[0] : '';
                const chunkCoreStart = chunkLeadingWs.length;
                const chunkCoreEnd = chunkTrailingWs.length > 0 ? chunk.length - chunkTrailingWs.length : chunk.length;
                const chunkCore = chunk.slice(chunkCoreStart, chunkCoreEnd);

                if (!chunkCore) {
                    translatedChunks.push(chunk);
                    continue;
                }

                const langPair = `${sourceLang}|${targetLang}`;
                const cKey = cacheKey(chunkCore, sourceLang, targetLang);
                const cached = cacheGet(cKey);
                let data;
                if (cached) {
                    data = cached;
                } else {
                    data = await apiLimiter.run(() => fetchTranslationWithRetry(chunkCore, langPair));
                    cacheSet(cKey, data);
                }

                const translatedChunk = data.responseData?.translatedText || chunkCore;
                translatedChunks.push(chunkLeadingWs + translatedChunk + chunkTrailingWs);

                if (data.responseData?.detectedLanguage) {
                    apiDetectedSource = data.responseData.detectedLanguage;
                }

                const matches = data.matches || [];
                if (matches.length > 0) {
                    const bestMatch = matches[0];
                    if (bestMatch.quality != null) {
                        totalQuality += Number(bestMatch.quality);
                        qualityCount++;
                    }
                    if (firstReference == null && bestMatch.reference) {
                        firstReference = bestMatch.reference;
                    }
                }
            }

            const joined = translatedChunks.join('');
            const decoded = he.decode(joined);
            const restored = decoded.replace(new RegExp(NL_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '\n');
            translatedTexts.push(leadingWs + restored + trailingWs);
        } catch (err) {
            const errMsg = `[Translate] Failed to translate text segment [${ti}]: ${err.message}`;
            logger.error(errMsg);
            translatedTexts.push(text); 
        }
    }

    const devanagariTargets = ['hi', 'bn', 'ne', 'mr', 'sa'];
    if (!devanagariTargets.includes(sourceLang) && !devanagariTargets.includes(targetLang)) {
        for (let i = 0; i < translatedTexts.length; i++) {
            translatedTexts[i] = translatedTexts[i].replace(/[\u0900-\u097F][\uFE00-\uFE0F\u200D]?/g, '');
        }
    }

    const RTL_LANGS = ['ar', 'he'];
    if (!RTL_LANGS.includes(targetLang)) {
        for (let i = 0; i < translatedTexts.length; i++) {
            translatedTexts[i] = translatedTexts[i].replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
        }
    }


    for (let i = 0; i < translatedTexts.length; i++) {
        translatedTexts[i] = postProcessTranslation(translatedTexts[i]);
    }

    const quality = qualityCount > 0 ? Math.round(totalQuality / qualityCount) : null;
    return { translatedTexts, quality, reference: firstReference, detectedSource: apiDetectedSource };
}

function collectEmbedText(embed) {
    const entries = [];
    if (embed.title) entries.push({ path: 'title', text: embed.title });
    if (embed.description) entries.push({ path: 'description', text: embed.description });
    if (embed.author?.name) entries.push({ path: 'author.name', text: embed.author.name });
    if (embed.footer?.text) entries.push({ path: 'footer.text', text: embed.footer.text });
    if (embed.fields) {
        embed.fields.forEach((field, i) => {
            if (field.name) entries.push({ path: `fields.${i}.name`, text: field.name });
            if (field.value) entries.push({ path: `fields.${i}.value`, text: field.value });
        });
    }
    return entries;
}

function setNested(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}

async function batchTranslateEntries(entries, sourceLang, targetLang) {
    const results = new Map();
    if (entries.length === 0) return results;

    for (const entry of entries) {
        try {
            const { translated } = await translateText(entry.text, sourceLang, targetLang);
            results.set(entry.path, translated);
        } catch (err) {
            logger.error(`[Translate] Failed to translate entry '${entry.path}': ${err.message}`);
            results.set(entry.path, entry.text); //
        }
    }

    return results;
}

async function translateEmbed(embed, sourceLang, targetLang) {
    const entries = collectEmbedText(embed);
    if (entries.length === 0) return { ...embed };

    const translated = await batchTranslateEntries(entries, sourceLang, targetLang);

    const newEmbed = JSON.parse(JSON.stringify(embed)); 

    for (const [path, text] of translated) {
        setNested(newEmbed, path, text);
    }

    return newEmbed;
}

function postProcessTranslation(text) {
    if (!text) return text;

    let result = text;

    result = result.replace(/\b[aA]n(?=[A-Z])/g, '');

    const brandNames = {
        'GitBook': '\x00GB\x00', 'Facebook': '\x00FB\x00', 'YouTube': '\x00YT\x00',
        'WhatsApp': '\x00WA\x00', 'GitHub': '\x00GH\x00', 'PayPal': '\x00PP\x00',
        'JavaScript': '\x00JS\x00', 'TypeScript': '\x00TS\x00', 'LinkedIn': '\x00LI\x00',
        'WordPress': '\x00WP\x00', 'TikTok': '\x00TT\x00', 'iPhone': '\x00IP\x00',
        'iPad': '\x00IPD\x00', 'macOS': '\x00MO\x00', 'iOS': '\x00IO\x00',
        'DevOps': '\x00DO\x00', 'OneDrive': '\x00OD\x00', 'PowerPoint': '\x00PPT\x00',
        'PlayStation': '\x00PS\x00', 'GameStop': '\x00GS\x00', 'FedEx': '\x00FE\x00',
    };
    for (const [brand, placeholder] of Object.entries(brandNames)) {
        result = result.replaceAll(brand, placeholder);
    }

    result = result.replace(/(?<=\b[A-Z][a-zA-Z]*)([a-z])(?=[A-Z][a-z])/g, '$1 ');

    for (const [brand, placeholder] of Object.entries(brandNames)) {
        result = result.replaceAll(placeholder, brand);
    }
g
    const merges = [
        { re: /\b(and|but|so|or)(we|you|they|i|it|he|she|the|this|that|these|those|wecannot|cannot|can|could|will|would)/gi, repl: '$1 $2' },
        { re: /\b(Servers)are\b/gi, repl: '$1 are' },
        { re: /\b(server)(Servers)\b/gi, repl: '$1 $2' },
        { re: /\b(server)(are|is|was|were|will|would|could|should|can|has|have|status|creation|contracts?|nodes?|instances?|embeds?|messages?|channels?|users?)\b/gi, repl: '$1 $2' },
        { re: /\b(Please)(do|not|don't|read|write|open|close|post|use|try|wait|keep)\b/gi, repl: '$1 $2' },
        { re: /\b(Purchase|Create|Delete|Make|Find|Use|Get|Have|Need|Want|Try|Run|Start|Stop|Choose|Select|Deploy|Buy)(a|the|some|any|coins?|packages?)\b/gi, repl: '$1 $2' },
        { re: /\b(We|You|They|I|It|He|She)(can't|cannot|can|could|will|would|should|must|have|need|want|are|do|did|go|going|is|was|has|does)\b/gi, repl: '$1 $2' },
        { re: /\b(Common)(Mistakes|Errors|Issues|Problems|Questions)\b/gi, repl: '$1 $2' },
        { re: /\b(free)(users|members|servers|accounts|plans)\b/gi, repl: '$1 $2' },
        { re: /\b(server)(creation|creator|stats|settings|deploy|deployment|delete|deletion)\b/gi, repl: '$1 $2' },
        { re: /\b(capacity)(issues|problems|errors|limits)\b/gi, repl: '$1 $2' },
        { re: /\b(active)(users|members|servers|sessions)\b/gi, repl: '$1 $2' },
    ];
    for (const merge of merges) {
        result = result.replace(merge.re, merge.repl);
    }

    result = result.replace(/\bDonot\b/g, 'Do not');
    result = result.replace(/\bdonot\b/g, 'do not');
    result = result.replace(/\bCanot\b/g, 'Cannot');
    result = result.replace(/\bcanot\b/g, 'cannot');
    result = result.replace(/\bWillnot\b/g, 'Will not');
    result = result.replace(/\bwillnot\b/g, 'will not');

    result = result.replace(
        /\ban(appointment|attempt|answer|example|option|error|issue|item|element|instance|opportunity|alternative|advantage|agreement|article)\b/gi,
        (match, word) => {
            const prefix = match[0] === 'A' ? 'An' : 'an';
            const rest = match[2] === match[2].toUpperCase()
                ? word[0].toUpperCase() + word.slice(1)
                : word[0].toLowerCase() + word.slice(1);
            return prefix + ' ' + rest;
        }
    );

    result = result.replace(
        /([a-z]\s+)(To|And|Or|But|For|In|On|At|With|By|From|About)\b/g,
        (match, before, word) => before + word.toLowerCase()
    );

    result = result.replace(/ {3,}/g, '  ');

    return result;
}
//
module.exports = {
    LANGUAGES,
    LANG_FLAGS,
    DISCORD_LOCALE_TO_LANG,
    getLanguageName,
    discordLocaleToLang,
    detectLanguage,
    translateText,
    collectEmbedText,
    setNested,
    batchTranslateEntries,
    translateEmbed,
    chunkText,
    parseFormattingSegments,
    reconstructFromSegments,
    isProbablyTextContent,
    postProcessTranslation,
    hasTranslatableContent,
};

// contributors: @relentiousdragon