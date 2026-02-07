const { SlashCommandBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, ThumbnailBuilder } = require("discord.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
const { settings } = require("../../util/settingsModule.js");
const e = require("../../data/emoji.js");
const { parseEmoji } = require("../../util/functions.js");
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("credits")
        .setDescription("View the credits and contributors of Waterfall")
        .setNameLocalizations(commandMeta.credits?.name || {})
        .setDescriptionLocalizations(commandMeta.credits?.description || {}),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    dev: false,
    explicit: false,
    async execute(bot, interaction, funcs, serverSettings, logger, t) {
        try {
            const container = buildCreditsContainer(bot, interaction, t);

            try {
                await interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (err) {
                if (err?.code === 10062 || (err?.message && err.message.includes("Unknown interaction"))) {
                    try {
                        await interaction.followUp({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2
                        });
                    } catch (err2) {
                        await interaction.reply({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }
                } else {
                    throw err;
                }
            }
        } catch (error) {
            logger.error("[/Credits] Error:", error);
            try {
                await interaction.reply({
                    content: `${e.pixel_cross} ${t('common:error')}`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                if (err?.code === 10062 || (err?.message && err.message.includes("Unknown interaction"))) {
                    try {
                        await interaction.followUp({
                            content: `${e.pixel_cross} ${t('common:error')}`,
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (err2) {
                        await interaction.reply({
                            content: `${e.pixel_cross} ${t('common:error')}`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                } else {
                    logger.error("[/Credits] reply error message failed:", err);
                }
            }
        }
    },
    buildCreditsContainer,
    help: {
        name: "credits",
        description: "View the credits and contributors of Waterfall",
        category: "Bot",
        permissions: [],
        botPermissions: [],
        created: 1768235600
    }
};

function buildCreditsContainer(bot, interaction, t) {
    const c = settings.c_emojis || {};

    const formatEmoji = (id) => id && id !== "?" ? `<:c:${id}>` : "";

    const agentEmojis12 = `${formatEmoji(c.agentzzrp_1)}${formatEmoji(c.agentzzrp_2)}`;
    const agentEmojis34 = `${formatEmoji(c.agentzzrp_3)}${formatEmoji(c.agentzzrp_4)}`;
    const robeloEmojis12 = `${formatEmoji(c.robelo06_1)}${formatEmoji(c.robelo06_2)}`;
    const robeloEmojis34 = `${formatEmoji(c.robelo06_3)}${formatEmoji(c.robelo06_4)}`;

    let botAvatar = bot.user.displayAvatarURL({ size: 256 });
    if (interaction.guild) {
        const botMember = interaction.guild.members.me;
        if (botMember?.avatar) {
            botAvatar = botMember.displayAvatarURL({ size: 256 });
        }
    }

    const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addSectionComponents(
            new SectionBuilder()
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar))
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# ${t('commands:credits.title')}`),
                    new TextDisplayBuilder().setContent(`-# ${t('commands:credits.subtext')}`)
                )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(
                new ButtonBuilder()
                    .setLabel("GitHub")
                    .setStyle(ButtonStyle.Link)
                    .setURL("https://github.com/relentiousdragon")
                    .setEmoji(parseEmoji(e.icon_github))
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    (agentEmojis12 ? `${agentEmojis12} **@agentzzrp**` : `**@agentzzrp**`) +
                    "\n" +
                    (agentEmojis34 ? `${agentEmojis34} ${t('commands:credits.lead_developer')}` : t('commands:credits.lead_developer'))
                )
            )
    );

    container.addSectionComponents(
        new SectionBuilder()
            .setButtonAccessory(
                new ButtonBuilder()
                    .setLabel("GitHub")
                    .setStyle(ButtonStyle.Link)
                    .setURL("https://github.com/Robelo06")
                    .setEmoji(parseEmoji(e.icon_github))
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    (robeloEmojis12 ? `${robeloEmojis12} **@robelo06**` : `**@robelo06**`) +
                    "\n" +
                    (robeloEmojis34 ? `${robeloEmojis34} ${t('commands:credits.developer')} & ${t('commands:credits.translator')} 🇮🇹` : `${t('commands:credits.developer')} & ${t('commands:credits.translator')} 🇮🇹`)
                )
            )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const contributors = [
        { name: "@yartz._.", roles: [`${t('commands:credits.tester')} & ${t('commands:credits.translator')} 🇵🇱`] },
        { name: "@legendphoenix66", roles: [t('commands:credits.tester')] },
        { name: "@megumin4808", roles: [`${t('commands:credits.translator')} 🇩🇪`] },
        { name: "@hatbax", roles: [`${t('commands:credits.translator')} 🇲🇽`] }
    ];

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${e.blurple_star} Contributors`)
    );

    for (const contributor of contributors) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**${contributor.name}** - ${contributor.roles.join(" & ")}`
            )
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Waterfall - [DevSiege Studios](https://github.com/DevSeige-Studios)`)
    );

    return container;
}

// contributors: @relentiousdragon