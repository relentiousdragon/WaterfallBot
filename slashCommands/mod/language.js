const { SlashCommandBuilder, MessageFlags, PermissionsBitField } = require("discord.js");
const { Server } = require("../../schemas/servers.js");
const e = require("../../data/emoji.js");
const commandMeta = require("../../util/i18n.js").getCommandMetadata();
//
module.exports = {
    data: new SlashCommandBuilder()
        .setName("language")
        .setNameLocalizations(commandMeta.language.name)
        .setDescription("Set the server language")
        .setDescriptionLocalizations(commandMeta.language.description)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName("type")
                .setDescription("Language to set")
                .setDescriptionLocalizations(commandMeta.language.option_type)
                .setRequired(true)
                .addChoices(
                    { name: "Deutsch", value: "de" },
                    { name: "English", value: "en" },
                    { name: "Español", value: "es" },
                    { name: "Français", value: "fr" },
                    { name: "Italiano", value: "it" },
                    { name: "日本語", value: "ja" },
                    { name: "Nederlands", value: "nl" },
                    { name: "Polski", value: "pl" },
                    { name: "Português", value: "pt" },
                    { name: "Русский", value: "ru" },
                    { name: "Svenska", value: "sv" },
                    { name: "Türkçe", value: "tr" },
                    { name: "中文", value: "zh" }
                )
        ),
    integration_types: [0],
    contexts: [0],
    dev: false,
    mod: false,
    beta: false,
    explicit: false,
    async execute(bot, interaction, funcs, settings, logger, t) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: `${e.pixel_cross} ${t('commands:language.error_permission')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const lang = interaction.options.getString("type");

        await Server.findOneAndUpdate(
            { serverID: interaction.guildId },
            { language: lang },
            { upsert: true, new: true }
        );

        return interaction.reply({
            content: `${e.checkmark_green} ${t('commands:language.success', { lang: lang.toUpperCase(), lng: lang })}`
        });
    },
    help: {
        name: "language",
        description: "Set the server language",
        category: "Moderation",
        permissions: ["ManageGuild"],
        botPermissions: [],
        created: 1764938508
    }
};
