const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder } = require("discord.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const e = require("../../data/emoji.js");
const WolframAlphaAPI = require('@wolfram-alpha/wolfram-alpha-api');

let waApi = null;
if (process.env.WOLFRAM_APPID) {
    waApi = WolframAlphaAPI(process.env.WOLFRAM_APPID);
}
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("wolframalpha")
        .setDescription("Query Wolfram|Alpha for computational answers")
        .setDescriptionLocalizations(commandMeta.wolfram.description)
        .addStringOption(opt => opt
            .setName("query")
            .setDescription("What to ask Wolfram|Alpha")
            .setNameLocalizations(commandMeta.wolfram.query_name)
            .setDescriptionLocalizations(commandMeta.wolfram.query_description)
            .setRequired(true)
            .setMaxLength(500)
        )
        .addBooleanOption(opt => opt
            .setName("simple")
            .setDescription("Force simple text answer (no images)")
            .setNameLocalizations(commandMeta.wolfram.simple_name)
            .setDescriptionLocalizations(commandMeta.wolfram.simple_description)
            .setRequired(false)
        ),
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!waApi) {
            return interaction.reply({
                content: `${e.deny} ${t('commands:wolfram.error_api_unavailable')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const query = interaction.options.getString("query");
        const forceSimple = interaction.options.getBoolean("simple") || false;

        await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

        try {
            const result = await queryWolfram(query, forceSimple, logger, t);

            const attachments = [];
            let mediaGallery = null;

            if (result.images && result.images.length > 0 && !forceSimple) {
                mediaGallery = new MediaGalleryBuilder();

                for (let i = 0; i < Math.min(result.images.length, 4); i++) {
                    const img = result.images[i];

                    if (img.type === 'base64') {
                        try {
                            const base64Data = img.data.split(';base64,').pop();
                            const buffer = Buffer.from(base64Data, 'base64');
                            const attachmentName = `wolfram_${Date.now()}_${i}.${img.format || 'png'}`;
                            const attachment = new AttachmentBuilder(buffer, { name: attachmentName });
                            attachments.push(attachment);

                            mediaGallery.addItems(
                                new MediaGalleryItemBuilder()
                                    .setURL(`attachment://${attachmentName}`)
                                    .setDescription(`Result ${i + 1}`)
                            );
                        } catch (imgError) {
                            logger.error("Failed to process base64 image:", imgError);
                        }
                    }
                }
            }

            const container = new ContainerBuilder()
                .setAccentColor(0xDD1100)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL("https://static.stands4.com/images/symbol/2886_wolfram-alpha-logo.png")
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# ${e.guide} ${t('commands:wolfram.result_title')}\n` +
                                `-# ${t('common:query')} ` +
                                `\`${query.substring(0, 150)}${query.length > 150 ? '...' : ''}\``
                            )
                        )
                );

            if (result.text) {
                container.addSeparatorComponents(
                    new SeparatorBuilder()
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `## ${t('commands:wolfram.answer_label')}\n${result.text}`
                    )
                );
            }

            if (mediaGallery && attachments.length > 0) {
                container.addSeparatorComponents(
                    new SeparatorBuilder()
                );
                container.addMediaGalleryComponents(mediaGallery);
            }

            container.addSeparatorComponents(
                new SeparatorBuilder()
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# Waterfall - ${t('commands:wolfram.attribution')}`
                )
            );

            await interaction.editReply({
                content: null,
                files: attachments,
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            logger.error("Wolfram command error:", error);
            await handleWolframError(interaction, error, settings, t, query);
        }
    },
    help: {
        name: "wolframalpha",
        description: "Query Wolfram|Alpha for computational answers",
        category: "Utility",
        permissions: [],
        botPermissions: ["EmbedLinks", "AttachFiles"],
        created: 1765526236
    }
};

async function queryWolfram(query, forceSimple, logger, t) {
    let images = [];
    let text = '';
    const queryLower = query.toLowerCase();
    const isVisualQuery = (queryLower.includes('plot') || queryLower.includes('graph') ||
        queryLower.includes('integral') || queryLower.includes('derivative') ||
        queryLower.includes('chart') || queryLower.includes('diagram') ||
        queryLower.includes('solve') || queryLower.includes('equation') ||
        queryLower.includes('function')) || queryLower.includes('weather') || queryLower.includes('forecast') || queryLower.includes('map') && !forceSimple;

    logger.debug(`Query: "${query}", Visual: ${isVisualQuery}, Simple: ${forceSimple}`);

    try {
        try {
            text = await waApi.getSpoken(query);
            logger.debug(`Got spoken result: ${text.substring(0, 100)}`);
        } catch (spokenError) {
            logger.debug(`Spoken API failed: ${spokenError.message}`);
            try {
                text = await waApi.getShort(query);
                logger.debug(`Got short result: ${text.substring(0, 100)}`);
            } catch (shortError) {
                text = ""
            }
        }

        if (isVisualQuery && !forceSimple) {
            try {
                logger.debug("Attempting to fetch image...");
                const imageData = await waApi.getSimple(query, {
                    width: 800,
                    fontsize: 14,
                    background: 'F5F5F5',
                    foreground: '000000',
                    timeout: 10000
                });

                logger.debug(`Simple API returned type: ${typeof imageData}, length: ${imageData?.length}`);

                if (imageData && typeof imageData === 'string' && imageData.startsWith('data:image')) {
                    const format = imageData.includes('image/gif') ? 'gif' :
                        imageData.includes('image/png') ? 'png' :
                            imageData.includes('image/jpeg') ? 'jpg' : 'png';

                    images.push({
                        type: 'base64',
                        data: imageData,
                        format: format,
                        width: 800,
                        height: 600
                    });

                    logger.debug(`Successfully added image (${format}) to results`);
                }
            } catch (simpleError) {
                logger.debug(`Simple API failed: ${simpleError.message}`);

                if (images.length === 0) {
                    try {
                        const fallbackImage = await waApi.getSimple(query, {
                            width: 400,
                            fontsize: 12,
                            timeout: 5000
                        });

                        if (fallbackImage && typeof fallbackImage === 'string' && fallbackImage.startsWith('data:image')) {
                            const format = fallbackImage.includes('image/gif') ? 'gif' : 'png';
                            images.push({
                                type: 'base64',
                                data: fallbackImage,
                                format: format,
                                width: 400,
                                height: 300
                            });
                        }
                    } catch (fallbackError) {
                        logger.debug(`Fallback image also failed: ${fallbackError.message}`);
                    }
                }
            }
        }

        if ((!text || text.trim().length === 0) && images.length > 0) {
            text = ''
        }

        if ((!text || text.trim().length === 0) && images.length === 0) {
            throw new Error(t('commands:wolfram.error_no_results'));
        }

        return { text, images };

    } catch (error) {
        logger.error("Query Wolfram error:", error);
        throw error;
    }
}

async function handleWolframError(interaction, error, settings, t, originalQuery) {
    let userMessage = t('commands:wolfram.error_generic');

    if (error.message.includes('403') || error.message.includes('rate limit')) {
        userMessage = t('commands:wolfram.error_rate_limit');
    } else if (error.message.includes('limit reached') || error.message.includes('exceeded')) {
        userMessage = t('commands:wolfram.error_api_limit');
    } else if (error.message.includes('Invalid appid') || error.message.includes('appid')) {
        userMessage = t('commands:wolfram.error_api_config');
    } else if (error.message.includes('did not understand') ||
        error.message.includes('No results') ||
        error.message.includes('Could not parse')) {
        userMessage = `${t('commands:wolfram.error_no_results')}\n\n**${t('commands:wolfram.try_these_examples')}**\n• \`plot sin(x)\`\n• \`graph y=x^2\`\n• \`integrate x^2\`\n• \`population of france\`\n• \`solve x^2 + 2x + 1 = 0\`\n• \`weather in london\``;
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        userMessage = t('commands:wolfram.error_timeout');
    }

    const errorContainer = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL("https://cdn.discordapp.com/emojis/1439628292436135936.png")
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${e.pixel_cross} ${t('commands:wolfram.error_title')}`
                    )
                )
        )
        .addSeparatorComponents(
            new SeparatorBuilder()
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(userMessage)
        );

    if (settings.devs && Array.isArray(settings.devs) && settings.devs.includes(interaction.user.id)) {
        errorContainer.addSeparatorComponents(
            new SeparatorBuilder()
        )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**Debug Info:**\n\`\`\`${error.message.substring(0, 150)}\`\`\``
                )
            );
    }

    errorContainer.addSeparatorComponents(
        new SeparatorBuilder()
    )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Waterfall - Wolfram|Alpha`)
        );

    await interaction.editReply({
        content: null,
        components: [errorContainer],
        flags: MessageFlags.IsComponentsV2
    });
}