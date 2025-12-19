const {
    SlashCommandBuilder, PermissionFlagsBits, ThumbnailBuilder, AutoModerationRuleTriggerType,
    AutoModerationRuleEventType, AutoModerationActionType, AutoModerationRuleKeywordPresetType,
    MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    EmbedBuilder, Colors, SelectMenuBuilder, SelectMenuOptionBuilder
} = require("discord.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const e = require("../../data/emoji.js");
const { parseEmoji } = require("../../util/functions.js");

const REGEX_PRESETS = {
    "simple_block": (keyword) => `(\\A|\\s)${escapeRegExp(keyword)}(\\z|\\s)`,
    "number_variants": (keyword) => generateNumberVariants(keyword),
    "symbol_variants": (keyword) => generateSymbolVariants(keyword),
    "letter_variants": (keyword) => generateLetterVariants(keyword),
    "emoji_variants": (keyword) => generateEmojiVariants(keyword),
    "unicode_variants": (keyword) => generateUnicodeVariants(keyword),
    "letter_spam": (keyword) => generateLetterSpam(keyword),
    "extra_whitespace": (keyword) => generateExtraWhitespace(keyword),
    "vowelless_variants": (keyword) => generateVowellessVariants(keyword),
    "character_deduplication": (keyword) => generateCharacterDeduplication(keyword),
    "partial_matches": (keyword) => generatePartialMatches(keyword)
};

const LINK_PRESETS = {
    "all_links": "(?:https?://?)(\\S*@)?[\\\\a-z0-9_\\-\\.\\%]*[a-z0-9_\\-%]+(\\.|%2e)[a-z(%[a-z0-9])]{2,}",
    "non_clickable_links": "(?:https?://?)?(\\S*@)?[\\\\a-z0-9_\\-\\.\\%]*[a-z0-9_\\-%]+(\\.|%2e)[a-z(%[a-z0-9])]{2,}",
    "invite_links": "(?:https?:\\/\\/)?(?:www\\.|ptb\\.|canary\\.)?discord(?:app)?\\.(?:(?:com|gg)[/\\\\]+(?:invite|servers)[/\\\\]+[a-z0-9-_]+)|discord\\.gg[/\\\\]+[a-z0-9-_]+",
    "third_party_invites": "(?:https?:\\/\\/)?(?:www\\.|ptb\\.|canary\\.)?discord(?:app)?\\.(?:(?:com|gg)[/\\\\]+(?:invite|servers)[/\\\\]+[a-z0-9-_]+)|(?:https?://)?(?:www\\.)?(?:dsc\\.gg|invite\\.gg+|discord\\.link|(?:discord\\.(gg|io|me|li|id))|disboard\\.org)[/\\\\]+[a-z0-9-_/]+",
    "emoji_spam": (limit = 6) => `(?s)(?i)(?:.*?(?:<a?:[a-z_0-9]+:[0-9]+>|\\p{Extended_Pictographic}|[\\u{1F1E6}-\\u{1F1FF}]|[0-9#\\*]\\u{fe0f})){${limit + 1},}`,
    "zalgo": "\\p{M}{3,}",
    "filter_accents": "\\p{M}{1,}",
    "headings": (level = 2) => {
        if (level === 2) return "(?m)^#\\s.*$";
        if (level === 3) return "(?m)^(> )?#{1,2}\\s.*$";
        return "(?m)^(> )?#{1,3}\\s.*$";
    },
    "inline_links": "\\[.*\\n*.*\\]\\(\\s*<?(?:https?://)?[a-z0-9_\\-\\.]*[a-z0-9_\\-]+\\.[a-z]{2,}.*>?\\s*\\)",
    "disguised_urls": "\\[.*[a-z0-9_\\-]+\\.[a-z]{2,}[\\/]?.*\\]\\(<?(?:https?://)?[a-z0-9_\\-\\.]*[a-z0-9_\\-]+\\.[a-z]{2,}.*>?\\)",
    "subtext": "(?m)^-#\\s.*$",
    "email_addresses": "[a-z0-9_\\-\\.\\+]+@[a-z0-9_\\-\\.]*[a-z0-9_\\-]+\\.[a-z]{2,}"
};

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateNumberVariants(keyword) {
    const patterns = {
        'a': '[a4]',
        'b': '[b8]',
        'e': '[e3]',
        'g': '[g9]',
        'i': '[i1]',
        'l': '[l1]',
        'o': '[o0]',
        's': '[s5]',
        't': '[t7]',
        'z': '[z2]'
    };

    let regex = keyword.toLowerCase();
    Object.entries(patterns).forEach(([char, pattern]) => {
        regex = regex.replace(new RegExp(char, 'g'), pattern);
    });

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateSymbolVariants(keyword) {
    const patterns = {
        'a': '[a@]',
        'b': '[b|3]',
        'c': '[c\\(]',
        'e': '[e£]',
        'h': '[h#]',
        'i': '[i!]',
        'l': '[l!|]',
        'o': '[o0]',
        'r': '[r®]',
        's': '[s$]',
        't': '[t+]'
    };

    let regex = keyword.toLowerCase();
    Object.entries(patterns).forEach(([char, pattern]) => {
        regex = regex.replace(new RegExp(char, 'g'), pattern);
    });

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateLetterVariants(keyword) {
    const patterns = {
        'a': '[a@]',
        'c': '[ck]',
        'e': '[e3]',
        'i': '[il1]',
        'k': '[kc]',
        'l': '[li1]',
        'o': '[o0]',
        's': '[sz]',
        't': '[t+]',
        'v': '[vu]',
        'w': '[wvv]',
        'z': '[zs]'
    };

    let regex = keyword.toLowerCase();
    Object.entries(patterns).forEach(([char, pattern]) => {
        regex = regex.replace(new RegExp(char, 'g'), pattern);
    });

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateEmojiVariants(keyword) {
    const emojiMap = {
        'a': '(a|�|🅰️)',
        'b': '(b|�|🅱️)',
        'c': '(c|�|©️)',
        'd': '(d|🇩)',
        'e': '(e|�)',
        'f': '(f|🇫)',
        'g': '(g|🇬)',
        'h': '(h|🇭)',
        'i': '(i|🇮|ℹ️)',
        'j': '(j|🇯)',
        'k': '(k|🇰)',
        'l': '(l|🇱)',
        'm': '(m|🇲|Ⓜ️)',
        'n': '(n|🇳)',
        'o': '(o|🇴|🅾️|⭕)',
        'p': '(p|🇵|🅿️)',
        'q': '(q|🇶)',
        'r': '(r|🇷|®️)',
        's': '(s|🇸)',
        't': '(t|🇹|™️)',
        'u': '(u|🇺)',
        'v': '(v|🇻)',
        'w': '(w|🇼)',
        'x': '(x|🇽|❌)',
        'y': '(y|🇾)',
        'z': '(z|🇿)',
        '0': '(0|0️⃣)',
        '1': '(1|1️⃣)',
        '2': '(2|2️⃣)',
        '3': '(3|3️⃣)',
        '4': '(4|4️⃣)',
        '5': '(5|5️⃣)',
        '6': '(6|6️⃣)',
        '7': '(7|7️⃣)',
        '8': '(8|8️⃣)',
        '9': '(9|9️⃣)'
    };

    let regex = '';
    for (const char of keyword.toLowerCase()) {
        regex += emojiMap[char] || char;
    }

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateUnicodeVariants(keyword) {
    const unicodeMap = {
        'a': '(a|а|α|а|ａ|𝐚|𝑎|𝒂|𝒶|𝓪|𝔞|𝕒|𝖆|𝖺|𝗮|𝘢|𝙖|𝚊|⍺|@)',
        'b': '(b|в|ь|Ь|ｂ|𝐛|𝑏|𝒃|𝒷|𝓫|𝔟|𝕓|𝖇|𝖻|𝗯|𝘣|𝙗|𝚋)',
        'c': '(c|с|ϲ|ⲥ|ｃ|𝐜|𝑐|𝒄|𝒸|𝓬|𝔠|𝕔|𝖈|𝖼|𝗰|𝘤|𝙘|𝚌|©|¢)',
        'd': '(d|ԁ|ⅾ|ｄ|𝐝|𝑑|𝒅|𝒹|𝓭|𝔡|𝕕|𝖉|𝖽|𝗱|𝘥|𝙙|𝚍)',
        'e': '(e|е|ё|є|ҽ|ꬲ|ｅ|𝐞|𝑒|𝒆|𝓮|𝔢|𝕖|𝖊|𝖾|𝗲|𝘦|𝙚|𝚎|€|£)',
        'f': '(f|ғ|ｆ|𝐟|𝑓|𝒇|𝒻|𝓯|𝔣|𝕗|𝖋|𝖿|𝗳|𝘧|𝙛|𝚏)',
        'g': '(g|ɡ|ｇ|𝐠|𝑔|𝒈|𝓰|𝔤|𝕘|𝖌|𝗀|𝗴|𝘨|𝙜|𝚐)',
        'h': '(h|һ|հ|Ꮒ|ｈ|𝐡|ℎ|𝒉|𝒽|𝓱|𝔥|𝕙|𝖍|𝗁|𝗵|𝘩|𝙝|𝚑)',
        'i': '(i|ı|і|ι|ӏ|ｊ|𝐢|𝑖|𝒊|𝒾|𝓲|𝔦|𝕚|𝖎|𝗂|𝗶|𝘪|𝙞|𝚒|!|1)',
        'j': '(j|ϳ|ј|ｊ|𝐣|𝑗|𝒋|𝒿|𝓳|𝔧|𝕛|𝖏|𝗃|𝗷|𝘫|𝙟|𝚓)',
        'k': '(k|к|κ|ｋ|𝐤|𝑘|𝒌|𝓀|𝓴|𝔨|𝕜|𝖐|𝗄|𝗸|𝘬|𝙠|𝚔)',
        'l': '(l|Ӏ|ӏ|ｌ|𝐥|𝑙|𝒍|𝓁|𝓵|𝔩|𝕝|𝖑|𝗅|𝗹|𝘭|𝙡|𝚕|1|!)',
        'm': '(m|м|ⅿ|ｍ|𝐦|𝑚|𝒎|𝓂|𝓶|𝔪|𝕞|𝖒|𝗆|𝗺|𝘮|𝙢|𝚖)',
        'n': '(n|ո|п|ｎ|𝐧|𝑛|𝒏|𝓃|𝓷|𝔫|𝕟|𝖓|𝗇|𝗻|𝘯|𝙣|𝚗)',
        'o': '(o|о|ο|σ|ｏ|𝐨|𝑜|𝒐|𝓸|𝔬|𝕠|𝖔|𝗈|𝗼|𝘰|𝙤|𝚘|0|⭕)',
        'p': '(p|р|ρ|ｐ|𝐩|𝑝|𝒑|𝓅|𝓹|𝔭|𝕡|𝖕|𝗉|𝗽|𝘱|𝙥|𝚙)',
        'q': '(q|ԛ|ｑ|𝐪|𝑞|𝒒|𝓆|𝓺|𝔮|𝕢|𝖖|𝗊|𝗾|𝘲|𝙦|𝚚)',
        'r': '(r|г|ｒ|𝐫|𝑟|𝒓|𝓇|𝓻|𝔯|𝕣|𝖗|𝗋|𝗿|𝘳|𝙧|𝚛)',
        's': '(s|ѕ|ｓ|𝐬|𝑠|𝒔|𝓈|𝓼|𝔰|𝕤|𝖘|𝗌|𝘀|𝘴|𝙨|𝚜|5|$)',
        't': '(t|т|τ|ｔ|𝐭|𝑡|𝒕|𝓉|𝓽|𝔱|𝕥|𝖙|𝗍|𝘁|𝘵|𝙩|𝚝|7|+)',
        'u': '(u|υ|ｕ|𝐮|𝑢|𝒖|𝓊|𝓾|𝔲|𝕦|𝖚|𝗎|𝘂|𝘶|𝙪|𝚞)',
        'v': '(v|ν|ѵ|ｖ|𝐯|𝑣|𝒗|𝓋|𝓿|𝔳|𝕧|𝖛|𝗏|𝘃|𝘷|𝙫|𝚟)',
        'w': '(w|ԝ|ｗ|𝐰|𝑤|𝒘|𝓌|𝔀|𝔴|𝕨|𝖜|𝗐|𝘄|𝘸|𝙬|𝚠)',
        'x': '(x|х|χ|ｘ|𝐱|𝑥|𝒙|𝓍|𝔁|𝔵|𝕩|𝖝|𝗑|𝘅|𝘹|𝙭|𝚡|×)',
        'y': '(y|у|ү|ｙ|𝐲|𝑦|𝒚|𝓎|𝔂|𝔶|𝕪|𝖞|𝗒|𝘆|𝘺|𝙮|𝚢)',
        'z': '(z|ᴢ|ｚ|𝐳|𝑧|𝒛|𝓏|𝔃|𝔷|𝕫|𝖟|𝗓|𝘇|𝘻|𝙯|𝚣)'
    };

    let regex = '';
    for (const char of keyword.toLowerCase()) {
        regex += unicodeMap[char] || char;
    }

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateLetterSpam(keyword) {
    const chars = keyword.split('');
    const spamPattern = chars.map(char => `${char}+`).join('');
    return `(\\A|\\s)${spamPattern}(\\z|\\s)`;
}

function generateExtraWhitespace(keyword) {
    const chars = keyword.split('');
    const spacedPattern = chars.map(char => `${char}\\s*`).join('');
    return `(\\A|\\s)${spacedPattern}(\\z|\\s)`;
}

function generateVowellessVariants(keyword) {
    const vowelPatterns = {
        'a': 'a?',
        'e': 'e?',
        'i': 'i?',
        'o': 'o?',
        'u': 'u?',
        'y': 'y?'
    };

    let regex = keyword.toLowerCase();
    Object.entries(vowelPatterns).forEach(([vowel, pattern]) => {
        regex = regex.replace(new RegExp(vowel, 'g'), pattern);
    });

    return `(\\A|\\s)${regex}(\\z|\\s)`;
}

function generateCharacterDeduplication(keyword) {
    const deduped = keyword.toLowerCase().replace(/(.)(?=\1)/g, '$1?');
    return `(\\A|\\s)${deduped}(\\z|\\s)`;
}

function generatePartialMatches(keyword) {
    return `(\\A|\\s)${escapeRegExp(keyword)}(\\z|\\s)`;
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("automod")
        .setDescription("Manage server auto-mod rules")
        .setNameLocalizations(commandMeta.automod.name)
        .setDescriptionLocalizations(commandMeta.automod.description)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName("setup")
            .setDescription("Interactive AutoMod setup with presets")
            .setNameLocalizations(commandMeta.automod.setup_name)
            .setDescriptionLocalizations(commandMeta.automod.setup_description)
            .addChannelOption(opt => opt
                .setName("log-channel")
                .setDescription("Channel for logging violations")
                .setNameLocalizations(commandMeta.automod.advanced_log_channel)
                .setDescriptionLocalizations(commandMeta.automod.advanced_log_channel_desc)
                .setRequired(false)
            )
            .addStringOption(opt => opt
                .setName("timeout")
                .setDescription("Duration for timeout action (optional)")
                .setNameLocalizations(commandMeta.automod.setup_timeout)
                .setDescriptionLocalizations(commandMeta.automod.setup_timeout_desc)
                .setRequired(false)
                .addChoices(
                    { name: "60 Seconds", value: "60s", name_localizations: commandMeta.automod.durations["60s"] },
                    { name: "5 Minutes", value: "5m", name_localizations: commandMeta.automod.durations["5m"] },
                    { name: "10 Minutes", value: "10m", name_localizations: commandMeta.automod.durations["10m"] },
                    { name: "1 Hour", value: "1h", name_localizations: commandMeta.automod.durations["1h"] },
                    { name: "1 Day", value: "1d", name_localizations: commandMeta.automod.durations["1d"] },
                    { name: "1 Week", value: "1w", name_localizations: commandMeta.automod.durations["1w"] }
                )
            )
        )
        .addSubcommand(sub => sub
            .setName("list")
            .setDescription("List all AutoMod rules")
            .setNameLocalizations(commandMeta.automod.list_name)
            .setDescriptionLocalizations(commandMeta.automod.list_description)
        )
        .addSubcommand(sub => sub
            .setName("create")
            .setDescription("Create a custom AutoMod rule")
            .setNameLocalizations(commandMeta.automod.create_name)
            .setDescriptionLocalizations(commandMeta.automod.create_description)
            .addStringOption(opt => opt
                .setName("name")
                .setDescription("Rule name")
                .setNameLocalizations(commandMeta.automod.create_rule_name)
                .setDescriptionLocalizations(commandMeta.automod.create_rule_name_desc)
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName("type")
                .setDescription("Rule type")
                .setNameLocalizations(commandMeta.automod.create_type)
                .setDescriptionLocalizations(commandMeta.automod.create_type_desc)
                .setRequired(true)
                .addChoices(
                    { name: "Block Keywords", value: "keyword", name_localizations: commandMeta.automod.rule_type_choices.keyword },
                    { name: "Block Spam", value: "spam", name_localizations: commandMeta.automod.rule_type_choices.spam },
                    { name: "Keyword Preset (Profanity/Slurs)", value: "preset", name_localizations: commandMeta.automod.rule_type_choices.preset },
                    { name: "Block Mention Spam", value: "mention", name_localizations: commandMeta.automod.rule_type_choices.mention },
                    { name: "Advanced Regex Filter", value: "regex", name_localizations: commandMeta.automod.rule_type_choices.regex }
                )
            )
            .addStringOption(opt => opt
                .setName("trigger")
                .setDescription("Trigger words/patterns (comma separated for keywords)")
                .setNameLocalizations(commandMeta.automod.create_trigger)
                .setDescriptionLocalizations(commandMeta.automod.create_trigger_desc)
                .setRequired(false)
            )
            .addStringOption(opt => opt
                .setName("action")
                .setDescription("Action to take")
                .setNameLocalizations(commandMeta.automod.create_action)
                .setDescriptionLocalizations(commandMeta.automod.create_action_desc)
                .setRequired(false)
                .addChoices(
                    { name: "Block Message", value: "block", name_localizations: commandMeta.automod.action_choices.block },
                    { name: "Send Alert", value: "alert", name_localizations: commandMeta.automod.action_choices.alert },
                    { name: "Timeout User", value: "timeout", name_localizations: commandMeta.automod.action_choices.timeout }
                )
            )
            .addStringOption(opt => opt
                .setName("duration")
                .setDescription("Timeout duration (if action is timeout)")
                .setNameLocalizations(commandMeta.automod.create_duration)
                .setDescriptionLocalizations(commandMeta.automod.create_duration_desc)
                .setRequired(false)
                .addChoices(
                    { name: "60 Seconds", value: "60s", name_localizations: commandMeta.automod.durations["60s"] },
                    { name: "5 Minutes", value: "5m", name_localizations: commandMeta.automod.durations["5m"] },
                    { name: "10 Minutes", value: "10m", name_localizations: commandMeta.automod.durations["10m"] },
                    { name: "1 Hour", value: "1h", name_localizations: commandMeta.automod.durations["1h"] },
                    { name: "1 Day", value: "1d", name_localizations: commandMeta.automod.durations["1d"] },
                    { name: "1 Week", value: "1w", name_localizations: commandMeta.automod.durations["1w"] }
                )
            )
            .addChannelOption(opt => opt
                .setName("log-channel")
                .setDescription("Channel for logging violations")
                .setNameLocalizations(commandMeta.automod.advanced_log_channel)
                .setDescriptionLocalizations(commandMeta.automod.advanced_log_channel_desc)
                .setRequired(false)
            )
        )
        .addSubcommand(sub => sub
            .setName("advanced")
            .setDescription("Create an advanced regex rule for a keyword")
            .setNameLocalizations(commandMeta.automod.advanced_name)
            .setDescriptionLocalizations(commandMeta.automod.advanced_description)
            .addStringOption(opt => opt
                .setName("name")
                .setDescription("Rule name")
                .setNameLocalizations(commandMeta.automod.create_rule_name)
                .setDescriptionLocalizations(commandMeta.automod.create_rule_name_desc)
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName("keyword")
                .setDescription("Base keyword to protect")
                .setNameLocalizations(commandMeta.automod.advanced_keyword)
                .setDescriptionLocalizations(commandMeta.automod.advanced_keyword_desc)
                .setRequired(true)
            )
            .addChannelOption(opt => opt
                .setName("log-channel")
                .setDescription("Channel for logging violations (optional)")
                .setNameLocalizations(commandMeta.automod.advanced_log_channel)
                .setDescriptionLocalizations(commandMeta.automod.advanced_log_channel_desc)
                .setRequired(false)
            )
            .addStringOption(opt => opt
                .setName("timeout")
                .setDescription("Duration for timeout action (optional)")
                .setNameLocalizations(commandMeta.automod.setup_timeout)
                .setDescriptionLocalizations(commandMeta.automod.setup_timeout_desc)
                .setRequired(false)
                .addChoices(
                    { name: "60 Seconds", value: "60s", name_localizations: commandMeta.automod.durations["60s"] },
                    { name: "5 Minutes", value: "5m", name_localizations: commandMeta.automod.durations["5m"] },
                    { name: "10 Minutes", value: "10m", name_localizations: commandMeta.automod.durations["10m"] },
                    { name: "1 Hour", value: "1h", name_localizations: commandMeta.automod.durations["1h"] },
                    { name: "1 Day", value: "1d", name_localizations: commandMeta.automod.durations["1d"] },
                    { name: "1 Week", value: "1w", name_localizations: commandMeta.automod.durations["1w"] }
                )
            )
        )
        .addSubcommand(sub => sub
            .setName("delete")
            .setDescription("Delete an AutoMod rule")
            .setNameLocalizations(commandMeta.automod.delete_name)
            .setDescriptionLocalizations(commandMeta.automod.delete_description)
            .addStringOption(opt => opt
                .setName("rule")
                .setDescription("Select a rule")
                .setNameLocalizations(commandMeta.automod.delete_rule)
                .setDescriptionLocalizations(commandMeta.automod.delete_rule_desc)
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(sub => sub
            .setName("toggle")
            .setDescription("Enable or disable an AutoMod rule")
            .setNameLocalizations(commandMeta.automod.toggle_name)
            .setDescriptionLocalizations(commandMeta.automod.toggle_description)
            .addStringOption(opt => opt
                .setName("rule")
                .setDescription("Select a rule")
                .setNameLocalizations(commandMeta.automod.toggle_rule)
                .setDescriptionLocalizations(commandMeta.automod.toggle_rule_desc)
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addBooleanOption(opt => opt
                .setName("enabled")
                .setDescription("Enable the rule")
                .setNameLocalizations(commandMeta.automod.toggle_enabled)
                .setDescriptionLocalizations(commandMeta.automod.toggle_enabled_desc)
                .setRequired(true)
            )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: `${e.deny} ${t('commands:automod.error_no_permission')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: `${e.deny} ${t('commands:automod.error_bot_no_permission')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case "setup":
                    await handleSetup(interaction, t, logger, bot);
                    break;
                case "list":
                    await handleList(interaction, t, logger, bot);
                    break;
                case "create":
                    await handleCreate(interaction, t, logger);
                    break;
                case "advanced":
                    await handleAdvanced(interaction, t, logger, bot);
                    break;
                case "delete":
                    await handleDelete(interaction, t, logger);
                    break;
                case "toggle":
                    await handleToggle(interaction, t, logger);
                    break;
            }
        } catch (error) {
            logger.error("AutoMod command error:", error);
            const errorMsg = error.code === 50035 ? t('commands:automod.error_max_rules', { max: 10 }) : t('commands:automod.error_api_failed');
            await interaction.reply({
                content: `${e.deny} ${errorMsg}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
    async autocomplete(interaction) {
        try {
            const rules = await interaction.guild.autoModerationRules.fetch();
            const choices = rules.map(rule => ({
                name: `${rule.name} (${rule.enabled ? 'Enabled' : 'Disabled'})`,
                value: rule.id
            }));
            await interaction.respond(choices.slice(0, 25));
        } catch (error) {
            await interaction.respond([]);
        }
    },
    help: {
        name: "automod",
        description: "Manage server auto-mod",
        category: "Moderation",
        permissions: ["ManageGuild"],
        botPermissions: ["ManageGuild"],
        created: 1764938508
    }
};

async function handleSetup(interaction, t, logger, bot) {
    const logChannel = interaction.options.getChannel("log-channel");
    const timeoutDuration = interaction.options.getString("timeout");

    await interaction.deferReply();

    const existingRules = await interaction.guild.autoModerationRules.fetch();
    const hasExistingSetupRules = existingRules.some(rule => rule.name.startsWith('w!'));

    const state = {
        logChannel,
        timeoutDuration,
        enabledPresets: new Set(),
        currentPage: 1,
        mentionLimit: 5,
        emojiSpamLimit: -1,
        headingLevel: -1,
        hasExistingSetupRules
    };

    const pages = createSetupPages(state, t, bot);
    const initialContainer = pages[state.currentPage - 1];

    const message = await interaction.editReply({
        content: null,
        components: [initialContainer],
        flags: MessageFlags.IsComponentsV2
    });

    const collector = message.createMessageComponentCollector({
        time: 600000,
        filter: i => i.user.id === interaction.user.id && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return;
            }

            const customId = i.customId;

            if (customId === 'setup_confirm') {
                await createPresetRules(interaction, state, t, logger);
                collector.stop();
                return;
            }

            if (customId === 'setup_cancel') {
                const components = [
                    new ContainerBuilder()
                        .setAccentColor(9309642)
                        .addSectionComponents(
                            new SectionBuilder()
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder()
                                        .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${e.pixel_cross} ${t('commands:automod.advanced_cancel_title')}`),
                                ),
                        )
                        .addSeparatorComponents(
                            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                        ).addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`-# Waterfall - Automod`)
                        ),
                ];
                await i.editReply({
                    components: components
                });
                collector.stop();
                return;
            }

            if (customId === 'setup_prev') {
                if (state.currentPage > 1) state.currentPage -= 1;
            } else if (customId === 'setup_next') {
                if (state.currentPage < pages.length) state.currentPage += 1;
            } else if (customId.startsWith('preset_')) {
                const preset = customId.replace('preset_', '');
                if (state.enabledPresets.has(preset)) {
                    state.enabledPresets.delete(preset);
                } else {
                    state.enabledPresets.add(preset);
                }
            } else if (customId.startsWith('link_')) {
                const linkPreset = customId.replace('link_', '');
                const targetKey = `link_${linkPreset}`;

                if (state.enabledPresets.has(targetKey)) {
                    state.enabledPresets.delete(targetKey);
                } else {
                    state.enabledPresets.add(targetKey);
                }

                if (state.enabledPresets.has(targetKey)) {
                    if (linkPreset === 'all_links') {
                        const toDisable = ['link_inline_links', 'link_disguised_urls', 'link_invite_links', 'link_third_party_invites'];
                        toDisable.forEach(k => state.enabledPresets.delete(k));
                    } else if (linkPreset === 'inline_links') {
                        state.enabledPresets.delete('link_disguised_urls');
                        state.enabledPresets.delete('link_all_links');
                    } else if (linkPreset === 'disguised_urls') {
                        state.enabledPresets.delete('link_inline_links');
                        state.enabledPresets.delete('link_all_links');
                    } else if (linkPreset === 'invite_links') {
                        state.enabledPresets.delete('link_third_party_invites');
                        state.enabledPresets.delete('link_all_links');
                    } else if (linkPreset === 'third_party_invites') {
                        state.enabledPresets.delete('link_invite_links');
                        state.enabledPresets.delete('link_all_links');
                    }
                }
            } else if (customId.startsWith('general_')) {
                const generalPreset = customId.replace('general_', '');
                if (state.enabledPresets.has(`general_${generalPreset}`)) {
                    state.enabledPresets.delete(`general_${generalPreset}`);
                } else {
                    state.enabledPresets.add(`general_${generalPreset}`);
                }
            } else if (customId.startsWith('emoji_')) {
                const limit = parseInt(customId.replace('emoji_', ''));
                state.emojiSpamLimit = limit;
            } else if (customId.startsWith('heading_')) {
                const level = customId.replace('heading_', '');
                state.headingLevel = level === 'max' ? 'max' : parseInt(level);
            } else if (customId.startsWith('mention_')) {
                const limit = customId.replace('mention_', '');
                state.mentionLimit = parseInt(limit);
            }

            const updatedPages = createSetupPages(state, t, bot);
            const updatedContainer = updatedPages[state.currentPage - 1];
            await i.editReply({
                components: [updatedContainer]
            });

        } catch (error) {
            logger.error("Setup interaction error:", error);
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            try {
                const components = [
                    new ContainerBuilder()
                        .setAccentColor(9309642)
                        .addSectionComponents(
                            new SectionBuilder()
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder()
                                        .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('commands:automod.advanced_timeout')}`),
                                    new TextDisplayBuilder().setContent(`-# Waterfall - Automod`),
                                ),
                        )
                ];
                await interaction.editReply({
                    content: null,
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (error) { }
        }
    });
}

function createSetupPages(state, t, bot) {
    const pages = [];

    const page1 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.settings_cog_blue} ${t('commands:automod.setup_title')}\n` +
                        `-# ${t('commands:automod.setup_desc', { count: 0, preset: 'CUSTOM' })}` +
                        (state.hasExistingSetupRules ? `\n-# ${e.warning} ${t('commands:automod.setup_override_notice')}` : '')
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### ${e.blurple_mod} ${t('commands:automod.core_protections')}\n` +
                `-# ${t('commands:automod.core_protections_desc', { default: 'Core auto-mod rules to keep your server safe.' })}`
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(false)
        );

    const corePresets = [
        {
            id: 'spam_protection',
            label: t('commands:automod.setup_rules.spam_protection'),
            description: t('commands:automod.setup_rules.spam_protection_desc', { default: 'Blocks spam messages' }),
            emoji: e.blurple_mod
        },
        {
            id: 'mention_spam',
            label: t('commands:automod.setup_rules.mention_spam'),
            description: t('commands:automod.setup_rules.mention_spam_desc', { default: 'Blocks messages with too many mentions' }),
            emoji: e.member
        },
        {
            id: 'profanity_filter',
            label: t('commands:automod.setup_rules.profanity_filter'),
            description: t('commands:automod.setup_rules.profanity_filter_desc', { default: 'Blocks profanity and slurs using Discord\'s preset' }),
            emoji: e.deny
        }
    ];

    corePresets.forEach(preset => {
        const isEnabled = state.enabledPresets.has(preset.id);
        page1.addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`preset_${preset.id}`)
                        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setLabel(isEnabled ? t('common:enabled') : t('common:disabled'))
                        .setEmoji(parseEmoji(isEnabled ? e.checkmark_green : e.red_point))
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${preset.label}**\n${preset.description}`
                    )
                )
        );
    });

    if (state.enabledPresets.has('mention_spam')) {
        page1.addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(false)
        );

        page1.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**${t('commands:automod.mention_limit', { default: 'Mention Limit' })}**\n` +
                `${t('commands:automod.mention_limit_desc', { default: 'Maximum mentions allowed in a message' })}`
            )
        );

        const mentionLimits = [3, 5, 8, 12];
        const mentionButtons = new ActionRowBuilder();
        mentionLimits.forEach(limit => {
            const isSelected = state.mentionLimit === limit;
            mentionButtons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`mention_${limit}`)
                    .setLabel(limit.toString())
                    .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
            );
        });
        page1.addActionRowComponents(mentionButtons);
    }

    page1.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page1.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# *${t('commands:automod.page_label', { default: 'Page' })} 1 / 3*`
        )
    );

    const page1Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_confirm')
                .setLabel(t('commands:automod.create_rule_button', { default: 'Create Rules' }))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('setup_cancel')
                .setLabel(t('commands:automod.cancel_button', { default: 'Cancel' }))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page1Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd))
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('setup_next')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_fwd))
        );

    page1.addActionRowComponents(page1Row1);
    page1.addActionRowComponents(page1Row2);

    pages.push(page1);

    const isZalgoEnabled = state.enabledPresets.has('general_zalgo');
    const isAccentsEnabled = state.enabledPresets.has('general_filter_accents');
    let warningText = "";

    if (isZalgoEnabled) {
        warningText = `\n-# ${e.warning} ${t('commands:automod.general_options.zalgo_warning_emoji')}`;
        if (!isAccentsEnabled) {
            warningText += `\n-# ${e.warning} ${t('commands:automod.general_options.zalgo_warning_accents')}`;
        }
    }


    const page2 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.chain} ${t('commands:automod.setup_rules.link_filter')}\n` +
                        `-# ${t('commands:automod.setup_rules.link_filter_desc', { default: 'Additional protection options for your server' })}` +
                        (state.hasExistingSetupRules ? `\n-# ${e.warning} ${t('commands:automod.setup_override_notice')}` : '') + `${warningText}`
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        );

    page2.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### ${e.chain} ${t('commands:automod.link_options_title', { default: 'Link Protection' })}`
        )
    );

    const linkOptions = [
        {
            id: 'all_links',
            label: t('commands:automod.link_options.all_links', { default: 'All Links' }),
            description: t('commands:automod.link_options.all_links_desc', { default: 'Blocks all links with bypass protection' })
        },
        {
            id: 'invite_links',
            label: t('commands:automod.link_options.invite_links', { default: 'Discord Invites' }),
            description: t('commands:automod.link_options.invite_links_desc', { default: 'Blocks official Discord invite links' })
        },
        {
            id: 'third_party_invites',
            label: t('commands:automod.link_options.third_party_invites', { default: '3rd Party Invites' }),
            description: t('commands:automod.link_options.third_party_invites_desc', { default: 'Includes third-party invite services' })
        },
        {
            id: 'inline_links',
            label: t('commands:automod.link_options.inline_links', { default: 'Inline Links' }),
            description: t('commands:automod.link_options.inline_links_desc', { default: 'Blocks disguised links with custom text' })
        },
        {
            id: 'disguised_urls',
            label: t('commands:automod.link_options.disguised_urls', { default: 'Disguised URLs Only' }),
            description: t('commands:automod.link_options.disguised_urls_desc', { default: 'Blocks only disguised domain links' })
        },
        {
            id: 'email_addresses',
            label: t('commands:automod.link_options.email_addresses', { default: 'Email Addresses' }),
            description: t('commands:automod.link_options.email_addresses_desc', { default: 'Blocks email addresses from being shared' })
        }
    ];

    linkOptions.forEach(opt => {
        const isEnabled = state.enabledPresets.has(`link_${opt.id}`);
        page2.addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`link_${opt.id}`)
                        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setLabel(isEnabled ? t('common:enabled') : t('common:disabled'))
                        .setEmoji(parseEmoji(isEnabled ? e.checkmark_green : e.chain))
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${opt.label}**\n${opt.description}`
                    )
                )
        );
    });

    page2.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(false)
    );

    page2.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### ${e.settings_cog} ${t('commands:automod.additional_options_title', { default: 'Additional Options' })}`
        )
    );

    const generalOptions = [
        {
            id: 'zalgo',
            label: t('commands:automod.general_options.zalgo', { default: 'Zalgo Text' }),
            description: t('commands:automod.general_options.zalgo_desc', { default: 'Blocks zalgo/obfuscated text' })
        },
        {
            id: 'filter_accents',
            label: t('commands:automod.general_options.filter_accents', { default: 'Filter Accents' }),
            description: t('commands:automod.general_options.filter_accents_desc', { default: 'Blocks messages with accents (e.g. héllo)' })
        }
    ];

    generalOptions.forEach(opt => {
        const isEnabled = state.enabledPresets.has(`general_${opt.id}`);
        const isDisabled = opt.id === 'filter_accents' && !isZalgoEnabled;

        page2.addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`general_${opt.id}`)
                        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setLabel(isEnabled ? t('common:enabled') : t('common:disabled'))
                        .setEmoji(parseEmoji(isEnabled ? e.checkmark_green : e.settings_cog))
                        .setDisabled(isDisabled)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${opt.label}**\n${opt.description}`
                    )
                )
        );
    });

    page2.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page2.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# *${t('commands:automod.page_label', { default: 'Page' })} 2 / 3*`
        )
    );

    const page2Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_confirm')
                .setLabel(t('commands:automod.create_rule_button', { default: 'Create Rules' }))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('setup_cancel')
                .setLabel(t('commands:automod.cancel_button', { default: 'Cancel' }))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page2Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd)),
            new ButtonBuilder()
                .setCustomId('setup_next')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_fwd))
        );

    page2.addActionRowComponents(page2Row1);
    page2.addActionRowComponents(page2Row2);

    pages.push(page2);

    const page3 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.settings_cog_blue} ${t('commands:automod.setup_rules.config_options', { default: 'Configuration Option' })}\n` +
                        `-# ${t('commands:automod.setup_rules.config_options_desc', { default: 'Fine-tune your auto-mod settings' })}` +
                        (state.hasExistingSetupRules ? `\n-# ${e.warning} ${t('commands:automod.setup_override_notice')}` : '')
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        );

    page3.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**${t('commands:automod.emoji_spam_limit', { default: 'Emoji Spam Limit' })}**\n` +
            `${t('commands:automod.emoji_spam_desc', { default: 'Maximum consecutive emojis allowed in a message' })}`
        )
    );

    const emojiLimits = [0, 3, 6, 9, 12];
    const emojiButtons = new ActionRowBuilder();
    emojiLimits.forEach(limit => {
        const isEnabled = state.emojiSpamLimit === limit;
        emojiButtons.addComponents(
            new ButtonBuilder()
                .setCustomId(`emoji_${limit}`)
                .setLabel(limit === 0 ? t('commands:automod.block_all', { default: 'Block All' }) : limit.toString())
                .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    });
    page3.addActionRowComponents(emojiButtons);

    page3.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**${t('commands:automod.max_heading_size', { default: 'Max Heading Size' })}**\n` +
            `${t('commands:automod.max_heading_desc', { default: 'Maximum heading level allowed' })}`
        )
    );

    const headingLevels = [2, 3, 'max'];
    const headingButtons = new ActionRowBuilder();
    headingLevels.forEach(level => {
        const isEnabled = state.headingLevel === level;
        headingButtons.addComponents(
            new ButtonBuilder()
                .setCustomId(`heading_${level}`)
                .setLabel(level === 'max' ? t('commands:automod.block_all', { default: 'Block All' }) : `H${level}`)
                .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    });
    page3.addActionRowComponents(headingButtons);

    page3.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(false)
    );

    const isSubtextEnabled = state.enabledPresets.has('general_subtext');
    page3.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(
                new ButtonBuilder()
                    .setCustomId('general_subtext')
                    .setStyle(isSubtextEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setLabel(isSubtextEnabled ? t('common:enabled') : t('common:disabled'))
                    .setEmoji(parseEmoji(isSubtextEnabled ? e.checkmark_green : e.settings_cog))
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${t('commands:automod.general_options.subtext', { default: 'Subtext' })}**\n${t('commands:automod.general_options.subtext_desc', { default: 'Blocks smaller text used for fake notices' })}`
                )
            )
    );


    if (state.logChannel) {
        page3.addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(false)
        );

        page3.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${e.channel} ${t('commands:automod.setup_log_channel', { channel: `<#${state.logChannel.id}>`, default: `Log channel: <#${state.logChannel.id}>` })}`
            )
        );
    }

    page3.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page3.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# *${t('commands:automod.page_label', { default: 'Page' })} 3 / 3*`
        )
    );

    const page3Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_confirm')
                .setLabel(t('commands:automod.create_rule_button', { default: 'Create Rules' }))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('setup_cancel')
                .setLabel(t('commands:automod.cancel_button', { default: 'Cancel' }))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page3Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('setup_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd))
        );

    page3.addActionRowComponents(page3Row1);
    page3.addActionRowComponents(page3Row2);

    pages.push(page3);

    return pages;
}

async function createPresetRules(interaction, state, t, logger) {
    try {
        const createdRules = [];
        const botMember = interaction.guild.members.me;

        let alertChannel = state.logChannel;
        if (alertChannel) {
            const perms = botMember.permissionsIn(alertChannel);
            if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) {
                await interaction.followUp({
                    content: `${e.warning} ${t('commands:automod.error_log_channel_permissions', { channel: alertChannel.toString() })}`,
                    flags: MessageFlags.Ephemeral
                });
                alertChannel = null;
            }
        }

        const existingRules = await interaction.guild.autoModerationRules.fetch();

        for (const rule of existingRules.values()) {
            if (rule.name.startsWith('w!')) {
                if (rule.triggerType === AutoModerationRuleTriggerType.MentionSpam ||
                    rule.triggerType === AutoModerationRuleTriggerType.Spam) {
                    continue;
                }

                try {
                    await rule.delete();
                    logger.info(`Deleted old setup rule: ${rule.name}`);
                } catch (error) {
                    logger.error(`Failed to delete rule ${rule.name}:`, error);
                }
            }
        }

        for (const preset of state.enabledPresets) {
            let ruleData = null;

            if (preset === 'spam_protection') {
                const existingSpam = existingRules.find(r => r.triggerType === AutoModerationRuleTriggerType.Spam);

                if (existingSpam) {
                    try {
                        const spamRuleData = {
                            name: `w! ${t('commands:automod.setup_rules.spam_protection', { default: 'Spam Protection' })}`,
                            enabled: true,
                            eventType: AutoModerationRuleEventType.MessageSend,
                            triggerType: AutoModerationRuleTriggerType.Spam,
                            actions: [
                                {
                                    type: AutoModerationActionType.BlockMessage,
                                    metadata: {
                                        customMessage: t('commands:automod.block_message_default', { default: 'Your message was blocked by the auto-mod system.' })
                                    }
                                },
                                ...(alertChannel ? [{
                                    type: AutoModerationActionType.SendAlertMessage,
                                    metadata: { channel: alertChannel }
                                }] : [])
                            ]
                        };

                        await existingSpam.edit(spamRuleData);
                        createdRules.push(existingSpam.name + " (Updated)");
                    } catch (error) {
                        logger.error(`Failed to update spam rule:`, error);
                    }
                }

                if (!existingSpam) {
                    ruleData = {
                        name: `w! ${t('commands:automod.setup_rules.spam_protection', { default: 'Spam Protection' })}`,
                        enabled: true,
                        eventType: AutoModerationRuleEventType.MessageSend,
                        triggerType: AutoModerationRuleTriggerType.Spam,
                        actions: [
                            {
                                type: AutoModerationActionType.BlockMessage,
                                metadata: {
                                    customMessage: t('commands:automod.block_message_default', { default: 'Your message was blocked by the auto-mod system.' })
                                }
                            },
                            ...(alertChannel ? [{
                                type: AutoModerationActionType.SendAlertMessage,
                                metadata: { channel: alertChannel }
                            }] : [])
                        ]
                    };
                }
            } else if (preset === 'mention_spam') {
                const existingMention = existingRules.find(r => r.triggerType === AutoModerationRuleTriggerType.MentionSpam);

                const mentionRuleData = {
                    name: `w! ${t('commands:automod.setup_rules.mention_spam', { default: 'Mention Spam' })}`,
                    enabled: true,
                    eventType: AutoModerationRuleEventType.MessageSend,
                    triggerType: AutoModerationRuleTriggerType.MentionSpam,
                    triggerMetadata: {
                        mentionTotalLimit: state.mentionLimit
                    },
                    actions: [
                        {
                            type: AutoModerationActionType.BlockMessage,
                            metadata: {
                                customMessage: t('commands:automod.block_message_mentions', { default: 'Your message contains too many mentions.' })
                            }
                        },
                        ...(alertChannel ? [{
                            type: AutoModerationActionType.SendAlertMessage,
                            metadata: { channel: alertChannel }
                        }] : [])
                    ]
                };

                if (existingMention) {
                    try {
                        await existingMention.edit(mentionRuleData);
                        createdRules.push(existingMention.name + " (Updated)");
                    } catch (error) {
                        logger.error(`Failed to update mention spam rule:`, error);
                    }
                } else {
                    ruleData = mentionRuleData;
                }
            } else if (preset === 'profanity_filter') {
                ruleData = {
                    name: `w! ${t('commands:automod.setup_rules.profanity_filter', { default: 'Profanity Filter' })}`,
                    enabled: true,
                    eventType: AutoModerationRuleEventType.MessageSend,
                    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
                    triggerMetadata: {
                        presets: [
                            AutoModerationRuleKeywordPresetType.Profanity,
                            AutoModerationRuleKeywordPresetType.SexualContent,
                            AutoModerationRuleKeywordPresetType.Slurs
                        ]
                    },
                    actions: [
                        {
                            type: AutoModerationActionType.BlockMessage,
                            metadata: {
                                customMessage: t('commands:automod.block_message_profanity', { default: 'Your message contains prohibited content.' })
                            }
                        },
                        ...(alertChannel ? [{
                            type: AutoModerationActionType.SendAlertMessage,
                            metadata: { channel: alertChannel }
                        }] : [])
                    ]
                };
            }

            if (ruleData) {
                try {
                    const rule = await interaction.guild.autoModerationRules.create(ruleData);
                    createdRules.push(rule.name);
                } catch (error) {
                    logger.error(`Failed to create rule ${ruleData.name}:`, error);
                }
            }
        }

        const allPatterns = {
            keywordFilters: [],
            regexPatterns: [],
            allowList: []
        };

        const hasLinkPresets = Array.from(state.enabledPresets).some(p => p.startsWith('link_'));
        if (hasLinkPresets) {
            const linkPatterns = combineLinkPatterns(state, interaction);
            allPatterns.keywordFilters.push(...linkPatterns.keywordFilter);
            allPatterns.regexPatterns.push(...linkPatterns.regexPatterns);
            allPatterns.allowList.push(...linkPatterns.allowList);
        }

        for (const preset of state.enabledPresets) {
            if (preset.startsWith('general_')) {
                const generalType = preset.replace('general_', '');
                switch (generalType) {
                    case 'zalgo':
                        if (!state.enabledPresets.has('general_filter_accents')) {
                            allPatterns.regexPatterns.push(LINK_PRESETS.zalgo);
                        }
                        break;
                    case 'filter_accents':
                        allPatterns.regexPatterns.push(LINK_PRESETS.filter_accents);
                        break;
                    case 'subtext':
                        allPatterns.regexPatterns.push(LINK_PRESETS.subtext);
                        break;
                }
            }
        }

        if (state.emojiSpamLimit >= 0) {
            allPatterns.regexPatterns.push(LINK_PRESETS.emoji_spam(state.emojiSpamLimit));
        }

        if (state.headingLevel >= 0 || state.headingLevel === "max") {
            allPatterns.regexPatterns.push(LINK_PRESETS.headings(state.headingLevel));
        }

        const uniqueKeywordFilters = [...new Set(allPatterns.keywordFilters)];
        const uniqueRegexPatterns = [...new Set(allPatterns.regexPatterns)];
        const uniqueAllowList = [...new Set(allPatterns.allowList)];

        if (uniqueKeywordFilters.length > 0 || uniqueRegexPatterns.length > 0) {
            let ruleName = "";

            if (hasLinkPresets && (uniqueKeywordFilters.length > 0 || uniqueRegexPatterns.length > 0)) {
                ruleName = `w! ${t('commands:automod.link_and_formatting_protection', { default: 'Link & Formatting Protection' })}`;
            } else if (hasLinkPresets) {
                ruleName = `w! ${t('commands:automod.link_protection_combined', { default: 'Link Protection' })}`;
            } else {
                ruleName = `w! ${t('commands:automod.setup_rules.formatting_protection', { default: 'Formatting Protection' })}`;
            }

            const ruleData = {
                name: ruleName,
                enabled: true,
                eventType: AutoModerationRuleEventType.MessageSend,
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: {
                    ...(uniqueKeywordFilters.length > 0 && { keywordFilter: uniqueKeywordFilters }),
                    ...(uniqueRegexPatterns.length > 0 && { regexPatterns: uniqueRegexPatterns }),
                    ...(uniqueAllowList.length > 0 && { allowList: uniqueAllowList })
                },
                actions: [
                    {
                        type: AutoModerationActionType.BlockMessage,
                        metadata: {
                            customMessage: t('commands:automod.block_message_default', { default: 'Your message was blocked by the auto-mod system.' })
                        }
                    },
                    ...(alertChannel ? [{
                        type: AutoModerationActionType.SendAlertMessage,
                        metadata: { channel: alertChannel }
                    }] : []),
                    ...(state.timeoutDuration ? [{
                        type: AutoModerationActionType.Timeout,
                        metadata: { durationSeconds: getDurationSeconds(state.timeoutDuration) }
                    }] : [])
                ]
            };

            try {
                const rule = await interaction.guild.autoModerationRules.create(ruleData);
                createdRules.push(rule.name);
            } catch (error) {
                logger.error(`Failed to create combined protection rule:`, error);
            }
        }

        const successContainer = new ContainerBuilder()
            .setAccentColor(0x10b981)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(
                        new ThumbnailBuilder()
                            .setURL("https://images.icon-icons.com/1527/PNG/512/shield_106660.png")
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${e.checkmark_green} ${t('commands:automod.setup_success_title', { default: 'AutoMod Setup Complete' })}\n` +
                            `${t('commands:automod.setup_success_desc', { count: createdRules.length, preset: 'CUSTOM' })}`
                        )
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(true)
            );

        if (createdRules.length > 0) {
            const rulesText = createdRules.map(name => `${e.blurple_checkmark} ${name}`).join("\n");
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${t('commands:automod.setup_rules_created', { default: 'Rules Created:' })}\n${rulesText}`
                )
            );
        }

        if (alertChannel) {
            successContainer.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(false)
            );
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${e.channel} ${t('commands:automod.setup_log_channel', { channel: `<#${alertChannel.id}>`, default: `Log channel: <#${alertChannel.id}>` })}`
                )
            );
        } else if (state.logChannel) {
            successContainer.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(false)
            );
            successContainer.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${e.warning} ${t('commands:automod.setup_log_channel_no_perms', { channel: `<#${state.logChannel.id}>`, default: `Log channel <#${state.logChannel.id}> skipped (missing permissions)` })}`
                )
            );
        }

        await interaction.editReply({
            components: [successContainer],
            flags: MessageFlags.IsComponentsV2
        });

    } catch (error) {
        logger.error("Failed to create preset rules:", error);
        const components = [
            new ContainerBuilder()
                .setAccentColor(9309642)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('commands:automod.advanced_error', { error: error.message, default: `Failed to create rules: ${error.message}` })}`),
                        ),
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(false)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Waterfall - Automod`),
                ),
        ];
        await interaction.editReply({
            components: components
        });
    }
}

function combineLinkPatterns(state, interaction) {
    const linkPresets = {
        'link_all_links': ["*http://*", "*https://*"],
        'link_invite_links': ["*discord.gg/*", "*discord.com/invite/*"],
        'link_third_party_invites': ["*discord.gg/*", "*discord.com/invite/*", "*dsc.gg/*", "*invite.gg/*"],
        'link_email_addresses': [LINK_PRESETS.email_addresses],
        'link_inline_links': [LINK_PRESETS.inline_links],
        'link_disguised_urls': [LINK_PRESETS.disguised_urls]
    };

    const keywordFilters = [];
    const regexPatterns = [];
    const allowList = [];

    for (const preset of state.enabledPresets) {
        if (linkPresets[preset]) {
            linkPresets[preset].forEach(item => {
                if (typeof item === 'string' && item.startsWith('*')) {
                    keywordFilters.push(item);
                } else {
                    regexPatterns.push(item);
                }
            });

            if (preset === 'link_invite_links' || preset === 'link_third_party_invites') {
                allowList.push(`discord.gg/${interaction.guild.id}`);
            }
        }
    }

    return {
        keywordFilter: [...new Set(keywordFilters)],
        regexPatterns: [...new Set(regexPatterns)],
        allowList: [...new Set(allowList)]
    };
}

async function handleList(interaction, t, logger, bot) {
    const rules = await interaction.guild.autoModerationRules.fetch();

    if (rules.size === 0) {
        return interaction.reply({
            content: `${e.info} ${t('commands:automod.list_no_rules')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const perPage = 4;
    const ruleArray = Array.from(rules.values());
    const totalPages = Math.max(1, Math.ceil(ruleArray.length / perPage));
    let page = 1;

    const truncate = (s, n = 80) => {
        if (!s) return '';
        return s.length > n ? `${s.slice(0, n - 1)}…` : s;
    };

    const typeMap = {
        [AutoModerationRuleTriggerType.Keyword]: t('commands:automod.rule_types.keyword'),
        [AutoModerationRuleTriggerType.Spam]: t('commands:automod.rule_types.spam'),
        [AutoModerationRuleTriggerType.KeywordPreset]: t('commands:automod.rule_types.preset'),
        [AutoModerationRuleTriggerType.MentionSpam]: t('commands:automod.rule_types.mention_spam')
    };

    const actionMap = {
        [AutoModerationActionType.BlockMessage]: t('commands:automod.action_types.block'),
        [AutoModerationActionType.SendAlertMessage]: t('commands:automod.action_types.alert'),
        [AutoModerationActionType.Timeout]: t('commands:automod.action_types.timeout')
    };

    function buildContainerForPage(p) {
        const start = (p - 1) * perPage;
        const pageRules = ruleArray.slice(start, start + perPage);

        const rulesList = pageRules.map(rule => {
            const s = rule.enabled ? e.green_point : e.red_point;
            const statusText = rule.enabled ? t('commands:automod.list_status_enabled') : t('commands:automod.list_status_disabled');

            const type = typeMap[rule.triggerType] || t('commands:automod.rule_types.unknown');

            let triggerDetail = '';
            if (rule.triggerType === AutoModerationRuleTriggerType.Keyword && rule.triggerMetadata?.keywordFilter?.length) {
                triggerDetail = truncate(rule.triggerMetadata.keywordFilter.join(', '), 80);
            } else if (rule.triggerType === AutoModerationRuleTriggerType.KeywordPreset && rule.triggerMetadata?.presets?.length) {
                triggerDetail = truncate(String(rule.triggerMetadata.presets.join(', ')), 80);
            } else if (rule.triggerType === AutoModerationRuleTriggerType.MentionSpam && rule.triggerMetadata?.mentionTotalLimit) {
                triggerDetail = `${rule.triggerMetadata.mentionTotalLimit} ${t('commands:automod.mentions')}`;
            }

            let actionText = '';
            if (Array.isArray(rule.actions) && rule.actions.length > 0) {
                const act = rule.actions[0];
                actionText = actionMap[act.type] || String(act.type);
            }

            const line1 = `${s} ${rule.name}`;
            const line2 = `${e.reply_cont} ${t('commands:automod.field_trigger')}: ${type}${triggerDetail ? ` - ${triggerDetail}` : ''}`;
            const line3 = `${e.reply_cont} ${t('commands:automod.field_action')}: ${actionText}`;
            const line4 = `${e.reply} **${statusText}**`;

            return `${line1}\n${line2}\n${line3}\n${line4}`;
        }).join('\n\n');

        const prevId = `automod_list_prev_${interaction.id}`;
        const nextId = `automod_list_next_${interaction.id}`;

        const components = [
            new ContainerBuilder()
                .setAccentColor(5329115)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder().setURL(bot.user.displayAvatarURL())
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# ${e.blurple_rulebook} ${t('commands:automod.list_title')}`),
                        ),
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${rulesList || t('commands:automod.list_no_rules')}`),
                )
                .addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# *${t('commands:automod.page_label')} ${p} / ${totalPages}*`),
                )
                .addActionRowComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setStyle(ButtonStyle.Primary)
                                .setCustomId(prevId)
                                .setEmoji(parseEmoji(e.arrow_bwd))
                                .setDisabled(p === 1),
                            new ButtonBuilder()
                                .setStyle(ButtonStyle.Primary)
                                .setCustomId(nextId)
                                .setEmoji(parseEmoji(e.arrow_fwd))
                                .setDisabled(p === totalPages),
                        ),
                ),
        ];

        return components;
    }

    const initialContainer = buildContainerForPage(page);

    const message = await interaction.reply({ content: null, components: initialContainer, flags: MessageFlags.IsComponentsV2 });

    const collector = message.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
        time: 600000
    });

    collector.on('collect', async i => {
        try {
            if (i.user.id !== interaction.user.id) {
                return i.reply({
                    content: `${e.deny} ${t('common:pagination.not_for_you')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return i.reply({
                    content: `${e.deny} ${t('commands:automod.error_no_permission')}`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await i.deferUpdate();
            const id = i.customId;
            if (id === `automod_list_prev_${interaction.id}`) {
                if (page > 1) page -= 1;
            } else if (id === `automod_list_next_${interaction.id}`) {
                if (page < totalPages) page += 1;
            }

            const updated = buildContainerForPage(page);
            await i.editReply({ components: updated });
        } catch (err) {
            logger.error('Pagination interaction error:', err);
        }
    });

    collector.on('end', async () => {
        try {
            const components = [
                new ContainerBuilder()
                    .setAccentColor(9309642)
                    .addSectionComponents(
                        new SectionBuilder()
                            .setThumbnailAccessory(
                                new ThumbnailBuilder()
                                    .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                            )
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# ${e.pixel_cross} ${t('commands:automod.advanced_cancel_title')}`),
                            ),
                    )
                    .addSeparatorComponents(
                        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                    ).addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`-# Waterfall - Automod`)
                    ),
            ];
            await interaction.editReply({ components: components });
        } catch (err) { }
    });
}

async function handleCreate(interaction, t, logger) {
    const name = interaction.options.getString("name");
    const type = interaction.options.getString("type");
    const trigger = interaction.options.getString("trigger");
    const action = interaction.options.getString("action") || "block";
    const duration = interaction.options.getString("duration");
    const logChannel = interaction.options.getChannel("log-channel");

    await interaction.deferReply();

    if (action == "alert" && !logChannel) {
        interaction.editReply({
            content: `${e.deny} ${t('commands:automod.error_no_log_channel')}`,
        });
        return;
    }
    const actionTypes = {
        block: [{
            type: AutoModerationActionType.BlockMessage,
            metadata: {
                customMessage: t('commands:automod.block_message_default')
            }
        }],
        alert: [{
            type: AutoModerationActionType.SendAlertMessage,
            metadata: {
                channel: logChannel.id
            }
        }],
        timeout: [{
            type: AutoModerationActionType.Timeout,
            metadata: {
                durationSeconds: duration ? getDurationSeconds(duration) : 60
            }
        }]
    };

    let ruleData = {
        name,
        enabled: true,
        eventType: AutoModerationRuleEventType.MessageSend,
        actions: actionTypes[action]
    };

    switch (type) {
        case "keyword":
            if (!trigger) {
                return interaction.editReply({
                    content: `${e.deny} ${t('commands:automod.error_invalid_keywords')}`
                });
            }
            ruleData.triggerType = AutoModerationRuleTriggerType.Keyword;
            ruleData.triggerMetadata = {
                keywordFilter: trigger.split(",").map(k => k.trim())
            };
            break;
        case "spam":
            ruleData.triggerType = AutoModerationRuleTriggerType.Spam;
            break;
        case "preset":
            ruleData.triggerType = AutoModerationRuleTriggerType.KeywordPreset;
            ruleData.triggerMetadata = {
                presets: [AutoModerationRuleKeywordPresetType.Profanity]
            };
            break;
        case "mention":
            {
                const existingMention = interaction.guild.autoModerationRules.cache.find(
                    r => r.triggerType === AutoModerationRuleTriggerType.MentionSpam
                );

                if (existingMention) {
                    return interaction.editReply({
                        content: `${e.deny} ${t('commands:automod.error_mention_exists', {
                            default: 'There is already a mention spam AutoMod rule in this server.'
                        })}`
                    });
                }
            }
            ruleData.triggerType = AutoModerationRuleTriggerType.MentionSpam;
            ruleData.triggerMetadata = { mentionTotalLimit: 5 };
            break;
        case "regex":
            if (!trigger) {
                return interaction.editReply({
                    content: `${e.deny} ${t('commands:automod.error_invalid_regex')}`
                });
            }
            ruleData.triggerType = AutoModerationRuleTriggerType.Keyword;
            ruleData.triggerMetadata = {
                regexPatterns: [trigger]
            };
            break;
    }

    await interaction.guild.autoModerationRules.create(ruleData);

    await interaction.editReply({
        content: `${e.checkmark_green} ${t('commands:automod.create_success', { name })}`
    });
}

async function handleAdvanced(interaction, t, logger, bot) {
    const ruleName = interaction.options.getString("name");
    const keyword = interaction.options.getString("keyword");
    const logChannel = interaction.options.getChannel("log-channel");
    const timeoutDuration = interaction.options.getString("timeout");

    await interaction.deferReply();

    const state = {
        ruleName,
        baseKeyword: keyword,
        enabledKeywordOptions: new Set(['simple_block']),
        currentPage: 1,
        logChannel,
        timeoutDuration
    };

    const pages = createAdvancedPages(state, t, bot);
    const initialContainer = pages[state.currentPage - 1];

    const message = await interaction.editReply({
        components: [initialContainer],
        flags: MessageFlags.IsComponentsV2
    });

    const collector = message.createMessageComponentCollector({
        time: 600000,
        filter: i => i.user.id === interaction.user.id && i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return;
            }

            const customId = i.customId;

            if (customId === 'adv_confirm') {
                const regexPreview = generateCombinedRegex(state);
                if (regexPreview.length > 250) {
                    interaction.followUp({ content: `${e.warning} ${t('commands:automod.regex_too_long', { length: regexPreview.length, default: `The generated regex is too long (${regexPreview.length} characters). Please disable some options to reduce the length.` })}`, flags: MessageFlags.Ephemeral });
                    return;
                }
                await createAdvancedRule(interaction, state, t, logger);
                collector.stop();
                return;
            }

            if (customId === 'adv_cancel') {
                const components = [
                    new ContainerBuilder()
                        .setAccentColor(9309642)
                        .addSectionComponents(
                            new SectionBuilder()
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder()
                                        .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`# ${e.pixel_cross} ${t('commands:automod.advanced_cancel_title')}`),
                                ),
                        )
                        .addSeparatorComponents(
                            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                        ).addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`-# Waterfall - Automod`)
                        ),

                ];
                await i.editReply({
                    content: null,
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                });
                collector.stop();
                return;
            }

            if (customId === 'adv_prev') {
                if (state.currentPage > 1) state.currentPage -= 1;
            } else if (customId === 'adv_next') {
                if (state.currentPage < pages.length) state.currentPage += 1;
            } else if (customId.startsWith('keyword_')) {
                const option = customId.replace('keyword_', '');
                if (state.enabledKeywordOptions.has(option)) {
                    state.enabledKeywordOptions.delete(option);
                } else {
                    state.enabledKeywordOptions.add(option);
                }
            }

            const updatedPages = createAdvancedPages(state, t, bot);
            const updatedContainer = updatedPages[state.currentPage - 1];
            await i.editReply({
                content: null,
                components: [updatedContainer],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("Advanced automod interaction error:", error);
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            try {
                const components = [
                    new ContainerBuilder()
                        .setAccentColor(9309642)
                        .addSectionComponents(
                            new SectionBuilder()
                                .setThumbnailAccessory(
                                    new ThumbnailBuilder()
                                        .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                                )
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${t('commands:automod.advanced_timeout')}`),
                                ),
                        )
                        .addSeparatorComponents(
                            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`-# Waterfall - Automod`)
                        ),
                ];
                await interaction.editReply({
                    content: null,
                    components: components,
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (error) { }
        }
    });
}

function createAdvancedPages(state, t, bot) {
    const pages = [];

    const page1 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.blurple_rulebook} ${t('commands:automod.advanced_title')}\n` +
                        `-# **${t('commands:automod.advanced_rule_name')}: ${state.ruleName}**\n` +
                        `-# **${t('commands:automod.advanced_base_keyword')}: \`${state.baseKeyword}\`**`
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        );

    const keywordOptions = [
        { id: 'simple_block', label: t('commands:automod.keyword_options.simple_block'), description: t('commands:automod.keyword_options.simple_block_desc'), emoji: e.shield },
        { id: 'number_variants', label: t('commands:automod.keyword_options.number_variants'), description: t('commands:automod.keyword_options.number_variants_desc'), emoji: e.number_symbol },
        { id: 'symbol_variants', label: t('commands:automod.keyword_options.symbol_variants'), description: t('commands:automod.keyword_options.symbol_variants_desc'), emoji: e.asterisk },
        { id: 'letter_variants', label: t('commands:automod.keyword_options.letter_variants'), description: t('commands:automod.keyword_options.letter_variants_desc'), emoji: e.abc },
        { id: 'emoji_variants', label: t('commands:automod.keyword_options.emoji_variants'), description: t('commands:automod.keyword_options.emoji_variants_desc'), emoji: e.emote }
    ];

    keywordOptions.forEach(opt => {
        const isEnabled = state.enabledKeywordOptions.has(opt.id);
        page1.addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`keyword_${opt.id}`)
                        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setLabel(isEnabled ? t('common:enabled') : t('common:disabled'))
                        .setEmoji(parseEmoji(isEnabled ? e.checkmark_green : e.red_point))
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${opt.label}**\n${opt.description}`
                    )
                )
        );
    });

    page1.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page1.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# *${t('commands:automod.page_label')} 1 / 3*`)
    );

    const page1Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_confirm')
                .setLabel(t('commands:automod.create_rule_button'))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('adv_cancel')
                .setLabel(t('commands:automod.cancel_button'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page1Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd))
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('adv_next')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_fwd))
        );

    page1.addActionRowComponents(page1Row1);
    page1.addActionRowComponents(page1Row2);

    pages.push(page1);

    const page2 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.blurple_rulebook} ${t('commands:automod.advanced_title')}\n` +
                        `-# **${t('commands:automod.advanced_rule_name')}: ${state.ruleName}**\n` +
                        `-# **${t('commands:automod.advanced_base_keyword')}: \`${state.baseKeyword}\`**`
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### ${t('commands:automod.keyword_options_title')}`
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(false)
        );

    const keywordOptions2 = [
        { id: 'unicode_variants', label: t('commands:automod.keyword_options.unicode_variants'), description: t('commands:automod.keyword_options.unicode_variants_desc'), emoji: e.globe },
        { id: 'letter_spam', label: t('commands:automod.keyword_options.letter_spam'), description: t('commands:automod.keyword_options.letter_spam_desc'), emoji: e.repeat },
        { id: 'extra_whitespace', label: t('commands:automod.keyword_options.extra_whitespace'), description: t('commands:automod.keyword_options.extra_whitespace_desc'), emoji: e.space },
        { id: 'vowelless_variants', label: t('commands:automod.keyword_options.vowelless_variants'), description: t('commands:automod.keyword_options.vowelless_variants_desc'), emoji: e.abc },
        { id: 'character_deduplication', label: t('commands:automod.keyword_options.character_deduplication'), description: t('commands:automod.keyword_options.character_deduplication_desc'), emoji: e.hash },
        { id: 'partial_matches', label: t('commands:automod.keyword_options.partial_matches'), description: t('commands:automod.keyword_options.partial_matches_desc'), emoji: e.magnifying_glass }
    ];

    keywordOptions2.forEach(opt => {
        const isEnabled = state.enabledKeywordOptions.has(opt.id);
        page2.addSectionComponents(
            new SectionBuilder()
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`keyword_${opt.id}`)
                        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setLabel(isEnabled ? t('common:enabled') : t('common:disabled'))
                        .setEmoji(parseEmoji(isEnabled ? e.checkmark_green : e.red_point))
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `**${opt.label}**\n${opt.description}`
                    )
                )
        );
    });

    page2.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page2.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# *${t('commands:automod.page_label')} 2 / 3*`)
    );

    const page2Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_confirm')
                .setLabel(t('commands:automod.create_rule_button'))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('adv_cancel')
                .setLabel(t('commands:automod.cancel_button'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page2Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd)),
            new ButtonBuilder()
                .setCustomId('adv_next')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_fwd))
        );

    page2.addActionRowComponents(page2Row1);
    page2.addActionRowComponents(page2Row2);

    pages.push(page2);

    const regexPreview = generateCombinedRegex(state);

    const page3 = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(bot.user.displayAvatarURL())
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.blurple_rulebook} ${t('commands:automod.advanced_title')}\n` +
                        `-# **${t('commands:automod.advanced_rule_name')}: ${state.ruleName}**\n` +
                        `-# **${t('commands:automod.advanced_base_keyword')}: \`${state.baseKeyword}\`**`
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### ${e.preview} ${t('commands:automod.regex_preview_title')}\n${t('commands:automod.regex_preview_desc')}`
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
                .setSpacing(SeparatorSpacingSize.Small)
                .setDivider(false)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `\`\`\`\n${regexPreview.substring(0, 1000)}\n\`\`\``
            )
        );

    if (regexPreview.length > 250) {
        page3.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `\n${e.warning} ${t('commands:automod.regex_too_long', { length: regexPreview.length, default: `The generated regex is too long (${regexPreview.length} characters). Please disable some options to reduce the length.` })}`
            )
        );
    }

    page3.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    );

    page3.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# *${t('commands:automod.page_label')} 3 / 3*`)
    );

    const page3Row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_confirm')
                .setLabel(t('commands:automod.create_rule_button'))
                .setStyle(ButtonStyle.Success)
                .setEmoji(parseEmoji(e.checkmark_green)),
            new ButtonBuilder()
                .setCustomId('adv_cancel')
                .setLabel(t('commands:automod.cancel_button'))
                .setStyle(ButtonStyle.Danger)
                .setEmoji(parseEmoji(e.deny))
        );

    const page3Row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('adv_prev')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(parseEmoji(e.arrow_bwd))
        );

    page3.addActionRowComponents(page3Row1);
    page3.addActionRowComponents(page3Row2);

    pages.push(page3);

    return pages;
}

function generateCombinedRegex(state) {
    let regexParts = [];

    if (state.enabledKeywordOptions.has('simple_block')) {
        regexParts.push(REGEX_PRESETS.simple_block(state.baseKeyword));
    }

    const variantOptions = ['number_variants', 'symbol_variants', 'letter_variants',
        'emoji_variants', 'unicode_variants', 'letter_spam',
        'extra_whitespace', 'vowelless_variants', 'character_deduplication',
        'partial_matches'];

    variantOptions.forEach(option => {
        if (state.enabledKeywordOptions.has(option)) {
            regexParts.push(REGEX_PRESETS[option](state.baseKeyword));
        }
    });

    return regexParts.join('|');
}

async function createAdvancedRule(interaction, state, t, logger) {
    try {
        const combinedRegex = generateCombinedRegex(state);

        const ruleData = {
            name: state.ruleName,
            enabled: true,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword,
            triggerMetadata: {
                //keywordFilter: [combinedRegex],
                regexPatterns: [combinedRegex]
            },
            actions: [
                {
                    type: AutoModerationActionType.BlockMessage,
                    metadata: {
                        customMessage: t('commands:automod.advanced_block_message')
                    }
                },
                ...(state.logChannel ? [{
                    type: AutoModerationActionType.SendAlertMessage,
                    metadata: { channel: state.logChannel }
                }] : []),
                ...(state.timeoutDuration ? [{
                    type: AutoModerationActionType.Timeout,
                    metadata: { durationSeconds: getDurationSeconds(state.timeoutDuration) }
                }] : [])
            ]
        };

        await interaction.guild.autoModerationRules.create(ruleData);

        const enabledKeywordCount = state.enabledKeywordOptions.size;

        const successContainer = new ContainerBuilder()
            .setAccentColor(0x10b981)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(
                        new ThumbnailBuilder()
                            .setURL("https://images.icon-icons.com/1527/PNG/512/shield_106660.png")
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${e.checkmark_green} ${t('commands:automod.advanced_success_title')}\n` +
                            `-# **${t('commands:automod.advanced_rule_name')}: ${state.ruleName}**\n` +
                            `-# **${t('commands:automod.advanced_protection_type')}: ${t('commands:automod.rule_types.advanced_regex')}**\n` +
                            `-# **${t('commands:automod.advanced_base_keyword')}: \`${state.baseKeyword}\`**`
                        )
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${e.chart} ${t('commands:automod.advanced_protections_enabled')}\n` +
                    `${e.blurple_checkmark} ${t('commands:automod.advanced_keyword_protections')}: ${enabledKeywordCount}\n\n` +
                    `-# ${e.info} ${t('commands:automod.advanced_success_note')}`
                )
            );

        await interaction.editReply({
            content: null,
            components: [successContainer],
            flags: MessageFlags.IsComponentsV2
        });

    } catch (error) {
        logger.error("Failed to create advanced rule:", error);
        let errorMessage = t('commands:automod.advanced_error', { error: error.message });
        if (error.code === 50035 && error.message.includes('trigger type 1')) {
            errorMessage = t('commands:automod.error_max_keyword_rules', { max: 6 });
        }

        const errorContainer = new ContainerBuilder()
            .setAccentColor(9309642)
            .addSectionComponents(
                new SectionBuilder()
                    .setThumbnailAccessory(
                        new ThumbnailBuilder()
                            .setURL("https://img.icons8.com/color/512/cancel--v3.png")
                    )
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`## ${e.pixel_cross} ${errorMessage}`),
                    ),
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(false)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Waterfall - Automod`),
            );

        await interaction.editReply({
            components: [errorContainer]
        });
    }
}

async function handleDelete(interaction, t, logger) {
    const ruleId = interaction.options.getString("rule");

    await interaction.deferReply();

    const rule = await interaction.guild.autoModerationRules.fetch(ruleId).catch(() => null);
    if (!rule) {
        return interaction.editReply({ content: `${e.deny} ${t('commands:automod.error_rule_not_found')}` });
    }

    const ruleName = rule.name;
    await rule.delete();

    await interaction.editReply({
        content: `${e.checkmark_green} ${t('commands:automod.delete_success', { name: ruleName })}`
    });
}

async function handleToggle(interaction, t, logger) {
    const ruleId = interaction.options.getString("rule");
    const enabled = interaction.options.getBoolean("enabled");

    await interaction.deferReply();

    const rule = await interaction.guild.autoModerationRules.fetch(ruleId).catch(() => null);
    if (!rule) {
        return interaction.editReply({ content: `${e.deny} ${t('commands:automod.error_rule_not_found')}` });
    }

    const ruleName = rule.name;
    await rule.setEnabled(enabled);

    const status = enabled ? t('commands:automod.list_status_enabled') : t('commands:automod.list_status_disabled');
    await interaction.editReply({
        content: `${e.checkmark_green} ${t('commands:automod.toggle_success', { name: ruleName, status: status.toLowerCase() })}`
    });
}

function getDurationSeconds(durationStr) {
    if (!durationStr) return 60;
    const durationMap = {
        "60s": 60,
        "5m": 300,
        "10m": 600,
        "1h": 3600,
        "1d": 86400,
        "1w": 604800
    };
    return durationMap[durationStr] || 60;
}