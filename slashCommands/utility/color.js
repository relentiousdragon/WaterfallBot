const { SlashCommandBuilder, MessageFlags, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ContainerBuilder } = require("discord.js");
const axios = require("axios");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("color")
        .setNameLocalizations(commandMeta.color.name)
        .setDescription("Get detailed information about a color")
        .setDescriptionLocalizations(commandMeta.color.description)
        .addStringOption(o =>
            o.setName("color")
                .setDescription("Hex color code (e.g., FF0000 or #FF0000)")
                .setDescriptionLocalizations(commandMeta.color.option_color)
                .setRequired(true)
                .setMaxLength(7)
        ),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        await interaction.reply({ content: `${e.loading} ${t("common:loading")}` });

        let input = interaction.options.getString("color").trim().toLowerCase();
        input = input.replace('#', '');
        let hex;

        const hexRegex = /^([0-9A-F]{3}|[0-9A-F]{6})$/i;
        if (!hexRegex.test(input)) {
            const errorEmbed = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL("https://cdn.discordapp.com/emojis/1439628292436135936.png")
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`${e.not_found} **${t('commands:color.invalid_format_title')}**\n${t('commands:color.invalid_format_msg')}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`**${t('commands:color.how_to_use')}**\n${e.green_point} ${t('commands:color.six_digit')}\n${e.green_point} ${t('commands:color.three_digit')}\n\n**${t('commands:color.examples')}**\n${t('commands:color.example_red')}\n${t('commands:color.example_green')}\n${t('commands:color.example_blue')}\n${t('commands:color.example_blurple')}`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`-# Waterfall - ${t('common:color')}`)
                );

            return interaction.editReply({
                content: null,
                components: [errorEmbed],
                flags: MessageFlags.IsComponentsV2
            });
        }

        hex = input.length === 3
            ? input.split('').map(c => c + c).join('')
            : input;

        try {
            const colorRes = await axios.get(`https://api.alexflipnote.dev/color/${hex}`, {
                timeout: 10000
            });

            const color = colorRes.data;
            const accentColor = parseInt(hex, 16) || 0x5865F2;

            const colorName = color.name || t('common:unnamed_color');

            const container = new ContainerBuilder()
                .setAccentColor(accentColor)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL(color.images.square)
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`# ${colorName}\n-# ${color.hex.string} | \`${color.hex.clean}\``),
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${e.diamond} **${t('commands:color.color_values')}**\n**${t('commands:color.rgb')}:** ${color.rgb.string}\n**${t('commands:color.hsl')}:** ${color.hsl.string}\n**${t('commands:color.cmyk')}:** ${color.cmyk.string}\n**${t('commands:color.integer')}:** ${color.int.toLocaleString()}\n**${t('commands:color.brightness')}:** ${color.brightness}%`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addMediaGalleryComponents(
                    new MediaGalleryBuilder()
                        .addItems(
                            new MediaGalleryItemBuilder()
                                .setURL(color.images.gradient)
                                .setDescription(t('commands:color.color_gradient'))
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${e.compass_green} **${t('commands:color.text_contrast')}**\n**${t('commands:color.recommended_text')}:** ${color.safe_text_color.name}\n**${t('commands:color.hex')}:** #${color.safe_text_color.hex}\n**${t('commands:color.rgb')}:** rgb(${color.safe_text_color.rgb.values.join(', ')})`)
                );

            if (color.websafe && color.websafe.hex.clean !== hex) {
                container.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${e.website} **${t('commands:color.web_safe')}**\n**${t('commands:color.hex')}:** ${color.websafe.hex.string}\n**${t('commands:color.rgb')}:** ${color.websafe.rgb.string}`)
                );
            }
            container.addSeparatorComponents(
                new SeparatorBuilder()
                    .setSpacing(SeparatorSpacingSize.Small)
                    .setDivider(true)
            )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`-# Waterfall - ${t('common:color')}`)
                );

            return interaction.editReply({
                content: null,
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            console.error("Color command error:", error.message);

            let errorMessage;
            if (error.response) {
                if (error.response.status === 404) {
                    errorMessage = t('commands:color.error_404');
                } else {
                    errorMessage = t('commands:color.error_api');
                }
            } else if (error.request) {
                errorMessage = t('commands:color.error_not_responding');
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = t('commands:color.error_not_found');
            } else {
                errorMessage = t('commands:color.error_unexpected');
            }

            const errorEmbed = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addSectionComponents(
                    new SectionBuilder()
                        .setThumbnailAccessory(
                            new ThumbnailBuilder()
                                .setURL("https://cdn.discordapp.com/emojis/1439628292436135936.png")
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`${e.not_found} **${t('commands:color.lookup_failed_title')}**\n${t('commands:color.lookup_failed_msg', { hex })}`)
                        )
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`${e.yellow_point} ${errorMessage}\n\n**${t('commands:color.troubleshooting')}**\n${e.green_point} ${t('commands:color.verify_hex')}\n${e.green_point} ${t('commands:color.ensure_exists')}\n\n**${t('commands:color.examples')}**\n${t('commands:color.example_red')}\n${t('commands:color.example_green')}\n${t('commands:color.example_blue')}`)
                )
                .addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSpacing(SeparatorSpacingSize.Small)
                        .setDivider(true)
                )
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`-# Waterfall - ${t('common:color')}`)
                );

            return interaction.editReply({
                content: null,
                components: [errorEmbed],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },
    help: {
        name: "color",
        description: "Get detailed information about any color using hex codes",
        category: "Utility",
        permissions: [],
        botPermissions: [],
        created: 1765369179
    }
};