require("dotenv").config();
const { SlashCommandBuilder, ContainerBuilder, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, MediaGalleryBuilder, MessageFlags, SeparatorSpacingSize, MediaGalleryItemBuilder, ThumbnailBuilder } = require('discord.js');
const axios = require('axios');
const GOOGLE_TENOR = process.env.GOOGLE_TENOR_API_KEY;
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const versions = ["20240206", "20230216", "20221001", "20201001"];

function emojiToUnicode(emoji) {
    return [...emoji]
        .map(char => {
            const codepoint = char.codePointAt(0).toString(16);
            return codepoint === "fe0f" ? "" : `u${codepoint}`;
        })
        .join("_");
}
function stripVariationSelectors(emoji) {
    return emoji.replace(/\uFE0F/g, "");
}

async function findValidEmojiImage(emoji1, emoji2) {
    const unicode1 = emojiToUnicode(emoji1);
    const unicode2 = emojiToUnicode(emoji2);
    for (const version of versions) {
        const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${version}/${unicode1}/${unicode1}_${unicode2}.png`;
        try {
            const response = await axios.head(url);
            if (response.status === 200) return url;
        } catch { }
    }
    return null;
}

async function getEmojiUrl(primary1, primary2, emoji1, emoji2) {
    let emojiUrl = await findValidEmojiImage(primary1, primary2);
    if (!emojiUrl) {
        const stripped1 = stripVariationSelectors(primary1);
        const stripped2 = stripVariationSelectors(primary2);
        emojiUrl = await findValidEmojiImage(stripped1, stripped2);
    }
    if (!emojiUrl) {
        const stripped1 = stripVariationSelectors(primary1);
        const stripped2 = stripVariationSelectors(primary2);
        emojiUrl = await findValidEmojiImage(stripped2, stripped1);
    }
    if (!emojiUrl && GOOGLE_TENOR) {
        const query = `${emoji1}_${emoji2}`;
        const url = `https://tenor.googleapis.com/v2/featured?key=${GOOGLE_TENOR}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v6&q=${query}`;
        try {
            const response = await axios.get(url);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                emojiUrl = data.results[0].media_formats.png_transparent.url;
            }
        } catch { }
    }
    return emojiUrl;
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName('generate')
        .setNameLocalizations(commandMeta.generate.name)
        .setDescription('Generate things using Waterfall')
        .setDescriptionLocalizations(commandMeta.generate.description)
        .addSubcommand(sub =>
            sub.setName('emoji')
                .setNameLocalizations(commandMeta.generate.emoji_name)
                .setDescription('Combine two emojis to create a new one!')
                .setDescriptionLocalizations(commandMeta.generate.emoji_description)
                .addStringOption(opt =>
                    opt.setName('emoji1')
                        .setDescription('First emoji')
                        .setDescriptionLocalizations(commandMeta.generate.emoji_options_emoji1_description)
                        .setRequired(true)
                        .setMaxLength(10)
                )
                .addStringOption(opt =>
                    opt.setName('emoji2')
                        .setDescription('Second emoji')
                        .setDescriptionLocalizations(commandMeta.generate.emoji_options_emoji2_description)
                        .setRequired(true)
                        .setMaxLength(10)
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
        if (sub === 'emoji') {
            const emoji1 = interaction.options.getString('emoji1').trim();
            const emoji2 = interaction.options.getString('emoji2').trim();
            const emojiRegex = /^[\p{Extended_Pictographic}\uFE0F]+$/u;
            if (!emojiRegex.test(emoji1) || !emojiRegex.test(emoji2)) {
                await interaction.reply({
                    content: `${e.pixel_cross} ${t('commands:generate.emoji.format_error')}`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });
            const emojiUrl = await getEmojiUrl(emoji1, emoji2, emoji1, emoji2);
            if (!emojiUrl) {
                await interaction.editReply({
                    content: `${e.pixel_cross} ${t('commands:generate.emoji.error')}`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            const botAvatar = interaction.client.user.displayAvatarURL();
            const container = new ContainerBuilder()
                .setAccentColor(0x5bd91c)
                .addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${t('commands:generate.emoji.title')}`))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emoji1} + ${emoji2}`))
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL('https://emoji-kitchen.com/img/Logo.6777a9d3.png'))
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true))
                .addMediaGalleryComponents(
                    new MediaGalleryBuilder()
                        .addItems(
                            new MediaGalleryItemBuilder()
                                .setURL(emojiUrl)
                                .setDescription('GENERATED EMOJI')
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Waterfall - Generate"))

            await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },
    help: {
        name: "generate",
        description: "Generate things using Waterfall",
        category: "Utility",
        permissions: [],
        botPermissions: ["EmbedLinks", "AttachFiles"],
        created: 1765712177
    }
};